import SwiftUI
import AuthenticationServices
import CryptoKit

// MARK: - Google and Microsoft sign-in
//
// Uses Apple's secure web sign-in sheet (ASWebAuthenticationSession) with PKCE, so no Google or Microsoft SDK
// is needed. The provider's token goes to the Oracle server (/api/app/oauth/google or /microsoft), which verifies
// it and returns a normal Oracle session. Buttons appear only when the server lists the client IDs
// (GOOGLE_IOS_CLIENT_ID, MICROSOFT_CLIENT_ID in the server's .env).

struct AuthConfig: Decodable {
    var google: String?
    var googleIos: String?
    var microsoft: String?
    var apple: Bool?
}

enum OAuthProvider: String { case google, microsoft, apple }

@MainActor final class OAuthSignIn: NSObject, ASWebAuthenticationPresentationContextProviding {
    enum Failure: LocalizedError {
        case cancelled, failed(String)
        var errorDescription: String? {
            switch self {
            case .cancelled: "Sign-in was cancelled."
            case .failed(let message): message
            }
        }
    }
    private var session: ASWebAuthenticationSession?

    /// Google: returns an ID token issued to the iOS client.
    /// Redirect: the reversed client ID, e.g. com.googleusercontent.apps.1234-abcd:/oauth2redirect
    func google(clientID: String) async throws -> String {
        let scheme = clientID.split(separator: ".").reversed().joined(separator: ".")
        let redirect = "\(scheme):/oauth2redirect"
        let verifier = Self.verifier()
        var url = URLComponents(string: "https://accounts.google.com/o/oauth2/v2/auth")!
        url.queryItems = [
            .init(name: "client_id", value: clientID), .init(name: "redirect_uri", value: redirect),
            .init(name: "response_type", value: "code"), .init(name: "scope", value: "openid email profile"),
            .init(name: "code_challenge", value: Self.challenge(verifier)), .init(name: "code_challenge_method", value: "S256"),
            .init(name: "prompt", value: "select_account"),
        ]
        let code = try await authorize(url.url!, scheme: scheme)
        let tokens = try await exchange("https://oauth2.googleapis.com/token", [
            "client_id": clientID, "code": code, "code_verifier": verifier,
            "grant_type": "authorization_code", "redirect_uri": redirect,
        ])
        guard let idToken = tokens["id_token"] as? String else { throw Failure.failed("Google didn’t return a sign-in token.") }
        return idToken
    }

    /// Microsoft (personal, work or school accounts): returns a Microsoft Graph access token.
    /// Redirect (Azure → Authentication → Mobile and desktop): msauth.com.oracleprototype.Oracle://auth
    func microsoft(clientID: String) async throws -> String {
        let scheme = "msauth.\(Bundle.main.bundleIdentifier ?? "com.oracleprototype.Oracle")"
        let redirect = "\(scheme)://auth"
        let scope = "openid profile User.Read"
        let verifier = Self.verifier()
        var url = URLComponents(string: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize")!
        url.queryItems = [
            .init(name: "client_id", value: clientID), .init(name: "redirect_uri", value: redirect),
            .init(name: "response_type", value: "code"), .init(name: "scope", value: scope),
            .init(name: "code_challenge", value: Self.challenge(verifier)), .init(name: "code_challenge_method", value: "S256"),
            .init(name: "prompt", value: "select_account"),
        ]
        let code = try await authorize(url.url!, scheme: scheme)
        let tokens = try await exchange("https://login.microsoftonline.com/common/oauth2/v2.0/token", [
            "client_id": clientID, "code": code, "code_verifier": verifier,
            "grant_type": "authorization_code", "redirect_uri": redirect, "scope": scope,
        ])
        guard let accessToken = tokens["access_token"] as? String else { throw Failure.failed("Microsoft didn’t return a sign-in token.") }
        return accessToken
    }

    // MARK: Steps

    private func authorize(_ url: URL, scheme: String) async throws -> String {
        let callback: URL = try await withCheckedThrowingContinuation { continuation in
            let web = ASWebAuthenticationSession(url: url, callbackURLScheme: scheme) { url, error in
                if let url { continuation.resume(returning: url) }
                else if (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin { continuation.resume(throwing: Failure.cancelled) }
                else { continuation.resume(throwing: Failure.failed(error?.localizedDescription ?? "Sign-in didn’t finish.")) }
            }
            web.presentationContextProvider = self
            session = web
            if !web.start() { continuation.resume(throwing: Failure.failed("Couldn’t open the sign-in page.")) }
        }
        let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
        if let error = items.first(where: { $0.name == "error" })?.value {
            throw error == "access_denied" ? Failure.cancelled : Failure.failed("Sign-in failed (\(error)).")
        }
        guard let code = items.first(where: { $0.name == "code" })?.value else { throw Failure.failed("No sign-in code came back.") }
        return code
    }

    private func exchange(_ endpoint: String, _ form: [String: String]) async throws -> [String: Any] {
        var request = URLRequest(url: URL(string: endpoint)!)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        var allowed = CharacterSet.alphanumerics; allowed.insert(charactersIn: "-._~")
        request.httpBody = form.map { "\($0.key)=\($0.value.addingPercentEncoding(withAllowedCharacters: allowed) ?? "")" }
            .joined(separator: "&").data(using: .utf8)
        let (data, response) = try await URLSession.shared.data(for: request)
        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        guard (response as? HTTPURLResponse)?.statusCode == 200 else {
            throw Failure.failed((json["error_description"] as? String) ?? "The sign-in provider refused the request.")
        }
        return json
    }

    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.keyWindow }.first ?? ASPresentationAnchor()
        }
    }

    private static func verifier() -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        return Data(bytes).base64URL
    }
    private static func challenge(_ verifier: String) -> String { Data(SHA256.hash(data: Data(verifier.utf8))).base64URL }
}

private extension Data {
    var base64URL: String {
        base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
}

/// "Continue with Google / Microsoft" buttons, shown only for providers the server has set up.
struct SocialSignInButtons: View {
    @Environment(OracleSession.self) private var session
    @State private var config: AuthConfig?
    @State private var busy: OAuthProvider?
    @State private var error: String?
    @State private var flow = OAuthSignIn()

    var body: some View {
        VStack(spacing: 10) {
            // Sign in with Apple first: App Review requires it alongside Google / Microsoft (guideline 4.8).
            if config?.apple == true {
                SignInWithAppleButton(.continue) { request in
                    request.requestedScopes = [.fullName, .email]
                } onCompletion: { result in
                    Task { await apple(result) }
                }
                .signInWithAppleButtonStyle(.black)
                .frame(height: 48)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                .disabled(busy != nil)
            }
            if let id = config?.googleIos { button(.google, title: "Continue with Google", icon: "g.circle.fill", clientID: id) }
            if let id = config?.microsoft { button(.microsoft, title: "Continue with Microsoft", icon: "square.grid.2x2.fill", clientID: id) }
            if let error { Text(error).font(.soft(.caption)).foregroundStyle(Ink.danger).frame(maxWidth: .infinity, alignment: .leading) }
        }
        .task(id: session.baseURL) { config = try? await session.request("api/app/auth-config") }
    }

    private func button(_ provider: OAuthProvider, title: String, icon: String, clientID: String) -> some View {
        Button { Task { await signIn(provider, clientID: clientID) } } label: {
            HStack(spacing: 10) {
                if busy == provider { ProgressView().tint(Ink.charcoal) } else { Image(systemName: icon).font(.title3.weight(.bold)) }
                Text(title)
            }
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(.chunky(Ink.paper, height: 48))
        .disabled(busy != nil)
    }

    private func apple(_ result: Result<ASAuthorization, Error>) async {
        error = nil
        switch result {
        case .failure(let failure):
            if (failure as? ASAuthorizationError)?.code != .canceled { error = "Sign in with Apple didn’t finish. Try again." }
        case .success(let authorization):
            guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
                  let data = credential.identityToken, let token = String(data: data, encoding: .utf8) else {
                error = "Sign in with Apple didn’t return a token."; return
            }
            busy = .apple
            defer { busy = nil }
            do {
                try await session.signIn(provider: .apple, credential: token,
                                         firstName: credential.fullName?.givenName, lastName: credential.fullName?.familyName)
            } catch {
                self.error = UserFacingError.from(error, context: "apple sign-in").message
            }
        }
    }

    private func signIn(_ provider: OAuthProvider, clientID: String) async {
        busy = provider; error = nil
        defer { busy = nil }
        do {
            let credential = provider == .google ? try await flow.google(clientID: clientID) : try await flow.microsoft(clientID: clientID)  // Apple uses its own button
            try await session.signIn(provider: provider, credential: credential)
        } catch OAuthSignIn.Failure.cancelled {
            return
        } catch {
            self.error = UserFacingError.from(error, context: "\(provider.rawValue) sign-in").message
        }
    }
}

// MARK: - Edit account

struct EditAccountScreen: View {
    @Environment(OracleSession.self) private var session
    @Environment(\.dismiss) private var dismiss
    struct Info: Decodable { var username: String?; var firstName: String?; var lastName: String?; var email: String?; var hasPassword: Bool?; var provider: String? }
    private struct Saved: Decodable { var ok: Bool?; var username: String? }

    @State private var info: Info?
    @State private var first = ""
    @State private var last = ""
    @State private var username = ""
    @State private var password = ""
    @State private var confirm = ""
    @State private var busy = false
    @State private var error: UserFacingError?
    @State private var saved = false
    @State private var confirmDelete = false
    @State private var deleting = false

    private var needsPassword: Bool { info?.hasPassword != true }
    private var canSave: Bool {
        !busy && !first.trimmingCharacters(in: .whitespaces).isEmpty && !last.trimmingCharacters(in: .whitespaces).isEmpty
            && username.count >= 3 && (needsPassword ? password.count >= 6 : (password.isEmpty || password.count >= 6)) && password == confirm
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if info == nil && error == nil {
                        HStack(spacing: 10) { ProgressView().tint(Ink.charcoal); Text("Loading your account…").font(.soft(.subheadline)) }
                            .frame(maxWidth: .infinity, alignment: .leading).inkCard()
                    }
                    if let provider = info?.provider {
                        NoticeCard(kind: .info, title: "Signed in with \(provider.capitalized)",
                                   message: info?.email.map { "Your account is linked to \($0)." } ?? "Your account is linked to \(provider.capitalized).")
                    }
                    TagCard(tag: "Your name", color: Ink.butter) {
                        VStack(spacing: 10) {
                            InkField(title: "First name", text: $first).textContentType(.givenName)
                            InkField(title: "Last name", text: $last).textContentType(.familyName)
                        }
                    }
                    TagCard(tag: "Username & password", color: Ink.periwinkle) {
                        VStack(alignment: .leading, spacing: 10) {
                            InkField(title: "Username", text: $username, symbol: "person")
                                .textContentType(.username).textInputAutocapitalization(.never).autocorrectionDisabled()
                            InkField(title: needsPassword ? "Password (at least 6 characters)" : "New password (optional)", text: $password, symbol: "lock", secure: true)
                                .textContentType(.newPassword)
                            if !password.isEmpty {
                                InkField(title: "Confirm password", text: $confirm, symbol: "lock", secure: true).textContentType(.newPassword)
                                if !confirm.isEmpty && confirm != password {
                                    Text("The passwords don’t match.").font(.soft(.caption)).foregroundStyle(Ink.danger)
                                }
                            }
                            Text(needsPassword ? "Set a password so you can also sign in with your username on any device."
                                               : "Leave the password empty to keep your current one.")
                                .font(.soft(.caption)).foregroundStyle(Ink.muted)
                        }
                    }
                    if let error { NoticeCard(kind: .error, title: error.title, message: error.message) }
                    if saved { NoticeCard(kind: .success, title: "Saved", message: "Your account is updated.") }
                    Button { save() } label: {
                        HStack { if busy { ProgressView().tint(.white) }; Text(busy ? "Saving…" : "Save changes") }.frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.chunky(Ink.blue, text: .white))
                    .disabled(!canSave)
                    TagCard(tag: "Delete account", color: Ink.pinkSoft) {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("Permanently deletes your Oracle account, points and sign-in. Answers you gave stay only as anonymous data.")
                                .font(.soft(.caption)).foregroundStyle(Ink.muted)
                            Button(role: .destructive) { confirmDelete = true } label: {
                                HStack { if deleting { ProgressView().tint(Ink.charcoal) }; Text(deleting ? "Deleting…" : "Delete my account") }.frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.chunky(Ink.pink, height: 44))
                            .disabled(deleting)
                        }
                    }
                }
                .padding(20)
                .frame(maxWidth: 600).frame(maxWidth: .infinity)
            }
            .background(DotBackground())
            .navigationTitle("Edit account")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(.hidden, for: .navigationBar)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() }.font(.bold(.body)) } }
        }
        .task { await load() }
        .confirmationDialog("Delete your Oracle account?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete account", role: .destructive) { delete() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This can’t be undone. Your points and gift-card balance will be lost.")
        }
    }

    private func delete() {
        deleting = true; error = nil
        Task {
            defer { deleting = false }
            do { try await session.deleteAccount(); dismiss() }
            catch { self.error = UserFacingError.from(error, context: "delete account") }
        }
    }

    private func load() async {
        do {
            let loaded: Info = try await session.request("api/app/account")
            info = loaded
            first = loaded.firstName ?? ""; last = loaded.lastName ?? ""; username = loaded.username ?? ""
            if first.isEmpty, let name = session.account?.name {
                let parts = name.split(separator: " ", maxSplits: 1).map(String.init)
                first = parts.first ?? ""; last = parts.count > 1 ? parts[1] : ""
            }
        } catch {
            self.error = UserFacingError.from(error, context: "load account")
        }
    }

    private func save() {
        busy = true; error = nil; saved = false
        Task {
            defer { busy = false }
            do {
                var body: [String: Any] = ["firstName": first.trimmingCharacters(in: .whitespaces), "lastName": last.trimmingCharacters(in: .whitespaces),
                                           "username": username.trimmingCharacters(in: .whitespaces).lowercased()]
                if !password.isEmpty { body["password"] = password }
                let _: Saved = try await session.request("api/app/account", body: body)
                try? await session.refreshAccount()
                info?.hasPassword = info?.hasPassword == true || !password.isEmpty
                password = ""; confirm = ""; saved = true
            } catch {
                self.error = UserFacingError.from(error, context: "save account")
            }
        }
    }
}
