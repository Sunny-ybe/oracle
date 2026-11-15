import SwiftUI
import UIKit

// In-app photo capture for requests. The photo goes to the Oracle server with the answer; the server's existing
// pipeline does the rest: Gemini checks it shows the place, counts people for headcount requests, picks the
// answer for photo requests, and blurs faces, badges, screens and plates before anything is stored or shown.

/// The system camera (photo library on the Simulator, which has no camera).
struct CameraPicker: UIViewControllerRepresentable {
    var onImage: (UIImage) -> Void
    @Environment(\.dismiss) private var dismiss

    static var hasCamera: Bool { UIImagePickerController.isSourceTypeAvailable(.camera) }

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = Self.hasCamera ? .camera : .photoLibrary
        if Self.hasCamera { picker.cameraCaptureMode = .photo }
        picker.delegate = context.coordinator
        return picker
    }
    func updateUIViewController(_ controller: UIImagePickerController, context: Context) {}
    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: CameraPicker
        init(_ parent: CameraPicker) { self.parent = parent }
        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            if let image = info[.originalImage] as? UIImage { parent.onImage(image) }
            parent.dismiss()
        }
        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { parent.dismiss() }
    }
}

enum PhotoUpload {
    /// Shrinks to at most 1600 px on the long side and encodes as JPEG, like the web app's capture,
    /// so uploads stay small (the server accepts up to 12 MB).
    static func dataURL(for image: UIImage, maxSide: CGFloat = 1600, quality: CGFloat = 0.75) -> String? {
        let scale = min(1, maxSide / max(image.size.width, image.size.height))
        let size = CGSize(width: (image.size.width * scale).rounded(), height: (image.size.height * scale).rounded())
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        let resized = UIGraphicsImageRenderer(size: size, format: format).image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
        guard let data = resized.jpegData(compressionQuality: quality) else { return nil }
        return "data:image/jpeg;base64,\(data.base64EncodedString())"
    }

    /// The privacy-masked photo the server sends back.
    static func image(fromDataURL raw: String?) -> UIImage? {
        guard let raw, let comma = raw.firstIndex(of: ","), let data = Data(base64Encoded: String(raw[raw.index(after: comma)...])) else { return nil }
        return UIImage(data: data)
    }
}

/// Photo step on a live request: required for photo / headcount requests, an optional bonus elsewhere.
struct PhotoCaptureCard: View {
    let sensor: String?
    @Binding var photo: UIImage?
    var disabled = false
    @State private var capturing = false

    private var required: Bool { sensor == "photo" || sensor == "people_count" }
    private var tag: String {
        switch sensor {
        case "people_count": "Headcount photo · earns a bonus"
        case "photo": "Photo · earns a bonus"
        default: "Add a photo · optional"
        }
    }
    private var hint: String {
        switch sensor {
        case "people_count": "Snap the room. Oracle counts the people for you."
        case "photo": "Show what it looks like. Oracle reads the photo to answer."
        default: "A photo makes your answer count for more."
        }
    }

    var body: some View {
        TagCard(tag: tag, color: Ink.pink) {
            VStack(alignment: .leading, spacing: 10) {
                if let photo {
                    Image(uiImage: photo).resizable().scaledToFill()
                        .frame(height: 180).frame(maxWidth: .infinity).clipped()
                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Ink.charcoal, lineWidth: 2))
                        .accessibilityLabel("Your photo")
                    HStack(spacing: 10) {
                        Button { capturing = true } label: { Label("Retake", systemImage: "camera.rotate").frame(maxWidth: .infinity) }
                            .buttonStyle(.chunky(Ink.paper, height: 42))
                        Button { self.photo = nil } label: { Label("Remove", systemImage: "trash").frame(maxWidth: .infinity) }
                            .buttonStyle(.chunky(Ink.paper, height: 42))
                    }
                    .disabled(disabled)
                } else {
                    HStack(spacing: 12) {
                        IconBadge(symbol: "camera.fill", fill: Ink.pinkSoft, size: 46)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(required ? "Take a photo" : "Add a photo").font(.bold(.headline)).foregroundStyle(Ink.charcoal)
                            Text(hint).font(.soft(.caption)).foregroundStyle(Ink.muted)
                        }
                        Spacer(minLength: 0)
                        Button(CameraPicker.hasCamera ? "Camera" : "Choose") { capturing = true }
                            .buttonStyle(.chunky(Ink.pink, height: 40)).fixedSize()
                            .disabled(disabled)
                            .accessibilityIdentifier("takePhoto")
                    }
                }
                Label("Faces, badges, screens and plates are blurred before anyone sees it.", systemImage: "eye.slash")
                    .font(.soft(.caption2)).foregroundStyle(Ink.muted)
            }
        }
        .fullScreenCover(isPresented: $capturing) {
            CameraPicker { photo = $0 }.ignoresSafeArea()
        }
    }
}
