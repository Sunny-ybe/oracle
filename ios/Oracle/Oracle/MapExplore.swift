import SwiftUI
import MapKit

/// Map provider: Apple MapKit renders every map in this app. The "Maps" button hands off to Apple Maps.
struct ExploreScreen: View {
    @Environment(Router.self) private var router
    @Environment(PlaceSearch.self) private var search
    @Environment(LocationService.self) private var location
    @Environment(Connectivity.self) private var network
    @State private var query = ""
    @State private var camera = MapCameraPosition.automatic
    @State private var locating = false
    @State private var locationNotice: UserFacingError?
    @FocusState private var searching: Bool

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                PlaceSearchBar(text: $query, focused: $searching, identifier: "exploreSearch") { submit($0) }
                HStack(spacing: 8) {
                    Button { nearMe() } label: {
                        HStack(spacing: 6) {
                            if locating { ProgressView().controlSize(.small).tint(Ink.charcoal) } else { Image(systemName: "location.fill") }
                            Text("Near me")
                        }.frame(minHeight: 22)
                    }
                    .buttonStyle(.chunky(Ink.butter, height: 40))
                    .disabled(locating)
                    if let area = search.area {
                        Chip(text: area.title, symbol: area.nearMe ? "location.fill" : "mappin.and.ellipse", fill: Ink.periSoft)
                            .accessibilityLabel("Showing \(area.title)")
                    }
                    Spacer(minLength: 0)
                }
                if !network.online {
                    NoticeCard(kind: .error, title: "You’re offline", message: "Search needs a connection. Places already loaded stay on the map.")
                }
                if let locationNotice {
                    NoticeCard(kind: .info, title: locationNotice.title, message: locationNotice.message)
                }
                content
            }
            .padding(.horizontal, 20).padding(.top, 8).padding(.bottom, 24)
            .frame(maxWidth: 600).frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(DotBackground())
        .navigationTitle("Explore")
        .toolbarBackground(.hidden, for: .navigationBar)
        .onChange(of: search.places) { _, places in withAnimation(.easeInOut(duration: 1)) { camera = .tiltedOverview(places) } }
        .onChange(of: router.focusExploreSearch) { _, focus in if focus { searching = true; router.focusExploreSearch = false } }
    }

    @ViewBuilder private var content: some View {
        switch search.phase {
        case .idle where !search.hasArea:
            VStack(alignment: .leading, spacing: 12) {
                OraHero(title: "explore anywhere", message: "Search a city or venue, or tap Near me.", oraSize: 88)
                FlowChips(items: ["Coffee near me", "Libraries in Seattle", "Parks in Austin"]) { submit($0) }
            }
        case .idle, .loading:
            HStack(spacing: 10) { ProgressView().tint(Ink.charcoal); Text("Searching Apple Maps…").font(.soft(.subheadline)).foregroundStyle(Ink.charcoal) }
                .frame(maxWidth: .infinity, minHeight: 120).inkCard()
        case .failed(let error):
            NoticeCard(kind: .error, title: error.title, message: error.message, actionTitle: "Retry") { search.retry() }
        case .empty(let message):
            NoticeCard(kind: .info, title: "No places found", message: message)
        case .loaded:
            mapCard
            if let selected = search.selected {
                SelectedPlaceCard(place: selected) { router.openPlace(selected, in: .explore) }
            }
            SectionTitle(text: "\(search.places.count) places")
            LazyVStack(spacing: 10) {
                ForEach(search.places) { place in
                    Button { search.select(place); router.openPlace(place, in: .explore) } label: {
                        PlaceRow(place: place, selected: place.id == search.selectedID)
                    }
                    .buttonStyle(SquishStyle())
                    .accessibilityIdentifier("exploreRow")
                }
            }
        }
    }

    /// The embedded map is a preview: panning is disabled so it never fights the scroll view.
    /// Pins stay tappable, and Expand opens the full interactive map.
    private var mapCard: some View {
        ZStack(alignment: .topTrailing) {
            Map(position: $camera, interactionModes: []) {
                ForEach(search.places) { place in
                    Annotation(place.name, coordinate: place.coordinate, anchor: .bottom) {
                        PlacePin(place: place, selected: place.id == search.selectedID) { search.select(place) }
                    }
                    .annotationTitles(.hidden)
                }
                if location.authorized { UserAnnotation() }
            }
            .mapStyle(.standard(elevation: .realistic, pointsOfInterest: .excludingAll))
            .frame(height: 230)
            .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(Ink.charcoal, lineWidth: Ink.line))
            .accessibilityLabel("Map preview of \(search.places.count) places")
            Button { router.fullMap = true } label: {
                Label("Expand", systemImage: "arrow.up.left.and.arrow.down.right").font(.bold(.subheadline))
            }
            .buttonStyle(.chunky(Ink.paper, height: 38))
            .padding(10)
            .accessibilityLabel("Open full screen map")
        }
        .background(RoundedRectangle(cornerRadius: 20, style: .continuous).fill(Ink.charcoal).offset(x: 5, y: 5))
        .padding(.trailing, 5).padding(.bottom, 5)
    }

    private func submit(_ text: String) {
        searching = false
        locationNotice = nil
        search.search(text)
    }

    private func nearMe() {
        locationNotice = nil
        locating = true
        Task {
            defer { locating = false }
            do { search.searchNearby(try await location.current()) }
            catch LocationService.LocationError.denied {
                locationNotice = .init(kind: .location, title: "Location access is off", message: "Search for a city or venue above, or allow location in iPhone Settings.")
            } catch {
                locationNotice = .init(kind: .location, title: "Couldn’t find your location", message: "Search for a city or venue above instead.")
            }
        }
    }
}

struct PlacePin: View {
    let place: NearbyPlace
    let selected: Bool
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Image(systemName: place.symbol)
                .font(.system(size: selected ? 17 : 13, weight: .bold))
                .foregroundStyle(Ink.charcoal)
                .frame(width: selected ? 42 : 32, height: selected ? 42 : 32)
                .background(Circle().fill(selected ? Ink.butter : place.tint))
                .overlay(Circle().strokeBorder(Ink.charcoal, lineWidth: 2.5))
                .background(Circle().fill(Ink.charcoal).offset(x: 2, y: 2))
                .frame(minWidth: 44, minHeight: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .animation(.spring(duration: 0.25), value: selected)
        .accessibilityLabel(place.name)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

struct SelectedPlaceCard: View {
    let place: NearbyPlace
    var primaryTitle = "See details"
    let open: () -> Void
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
                VenueSnapshotFill(place: place, showsLabel: false) { IconBadge(symbol: place.symbol, fill: place.tint, size: 44) }
                    .frame(width: 64, height: 64)
                    .background(place.tint.opacity(0.35))
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Ink.charcoal, lineWidth: 2))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(place.name).font(.display(.headline)).foregroundStyle(Ink.charcoal).lineLimit(2)
                    if !place.subtitle.isEmpty { Text(place.subtitle).font(.soft(.caption)).foregroundStyle(Ink.muted).lineLimit(2) }
                }
                Spacer(minLength: 0)
            }
            HStack(spacing: 8) {
                Button(action: open) { Text(primaryTitle).frame(maxWidth: .infinity) }.buttonStyle(.chunky(Ink.blue, text: .white, height: 44))
                Button { place.openInAppleMaps() } label: {
                    Label("Maps", systemImage: "map").lineLimit(1).minimumScaleFactor(0.75).frame(maxWidth: .infinity)
                }
                .buttonStyle(.chunky(Ink.paper, height: 44))
                .accessibilityLabel("Open in Apple Maps")
            }
        }
        .inkCard(fill: Ink.butterSoft)
    }
}

/// Full-screen interactive map: pan, zoom, recenter, selectable pins and a detail card.
struct FullMapScreen: View {
    @Environment(Router.self) private var router
    @Environment(PlaceSearch.self) private var search
    @Environment(LocationService.self) private var location
    @Environment(\.dismiss) private var dismiss
    @State private var camera = MapCameraPosition.automatic
    @State private var satellite = false
    @Namespace private var mapScope

    var body: some View {
        ZStack(alignment: .top) {
            Map(position: $camera, scope: mapScope) {
                ForEach(search.places) { place in
                    Annotation(place.name, coordinate: place.coordinate, anchor: .bottom) {
                        PlacePin(place: place, selected: place.id == search.selectedID) {
                            search.select(place)
                            withAnimation(.easeInOut(duration: 1.2)) { camera = .tilted(place.coordinate) }
                        }
                    }
                    .annotationTitles(place.id == search.selectedID ? .visible : .hidden)
                }
                if location.authorized { UserAnnotation() }
            }
            .mapStyle(satellite ? .hybrid(elevation: .realistic, pointsOfInterest: .excludingAll) : .standard(elevation: .realistic, pointsOfInterest: .excludingAll))
            .mapControls { MapCompass(scope: mapScope); MapPitchToggle(scope: mapScope); MapScaleView(scope: mapScope) }
            .ignoresSafeArea()

            HStack(alignment: .top) {
                Button { dismiss() } label: { Image(systemName: "xmark").font(.headline.weight(.heavy)).frame(width: 22, height: 22) }
                    .buttonStyle(.chunky(Ink.paper, height: 46))
                    .accessibilityLabel("Close map")
                Spacer()
                if let area = search.area { Chip(text: area.title, symbol: "mappin.and.ellipse", fill: Ink.periSoft).padding(.top, 10) }
                Spacer()
                VStack(spacing: 10) {
                    Button { withAnimation(.easeInOut(duration: 1.2)) { camera = .tiltedOverview(search.places) } } label: { Image(systemName: "scope").font(.headline.weight(.heavy)).frame(width: 22, height: 22) }
                        .buttonStyle(.chunky(Ink.paper, height: 46))
                        .accessibilityLabel("Recenter on all places")
                    Button { withAnimation { satellite.toggle() } } label: {
                        Image(systemName: satellite ? "map.fill" : "globe.americas.fill").font(.headline.weight(.heavy)).frame(width: 22, height: 22)
                    }
                    .buttonStyle(.chunky(Ink.paper, height: 46))
                    .accessibilityLabel(satellite ? "Show standard map" : "Show satellite map")
                    if location.authorized {
                        Button { withAnimation(.easeInOut(duration: 1.2)) { camera = location.last.map { .tilted($0.coordinate) } ?? .userLocation(fallback: .automatic) } } label: {
                            Image(systemName: "location.fill").font(.headline.weight(.heavy)).frame(width: 22, height: 22)
                        }
                        .buttonStyle(.chunky(Ink.paper, height: 46))
                        .accessibilityLabel("Show my location")
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 6)
        }
        .overlay(alignment: .bottom) {
            if let place = search.selected {
                SelectedPlaceCard(place: place) {
                    dismiss()
                    // Same destination as tapping the list row.
                    Task { try? await Task.sleep(for: .milliseconds(350)); router.openPlace(place, in: .explore) }
                }
                .padding(.horizontal, 16).padding(.bottom, 12)
                .transition(.move(edge: .bottom).combined(with: .opacity))
            } else if search.places.isEmpty {
                NoticeCard(kind: .info, title: "No places on the map", message: "Close the map and search for a city or venue.")
                    .padding(16)
            }
        }
        .animation(.spring(duration: 0.3), value: search.selectedID)
        .mapScope(mapScope)
        .onAppear {
            camera = search.selected.map { .tilted($0.coordinate, distance: 1200) } ?? .tiltedOverview(search.places)
        }
    }
}

// MARK: - 3D camera (Apple Maps–style tilted view)

extension MapCameraPosition {
    /// Looks at one spot from an angle, so buildings render in 3D.
    static func tilted(_ center: CLLocationCoordinate2D, distance: CLLocationDistance = 650,
                       heading: CLLocationDirection = 25, pitch: Double = 62) -> MapCameraPosition {
        .camera(MapCamera(centerCoordinate: center, distance: distance, heading: heading, pitch: pitch))
    }

    /// A tilted view that frames every place, zoomed out enough that pins don't pile up
    /// (flat automatic framing when there are none).
    static func tiltedOverview(_ places: [NearbyPlace]) -> MapCameraPosition {
        guard let minLat = places.map(\.lat).min(), let maxLat = places.map(\.lat).max(),
              let minLng = places.map(\.lng).min(), let maxLng = places.map(\.lng).max() else { return .automatic }
        let center = CLLocationCoordinate2D(latitude: (minLat + maxLat) / 2, longitude: (minLng + maxLng) / 2)
        let span = CLLocation(latitude: minLat, longitude: minLng).distance(from: CLLocation(latitude: maxLat, longitude: maxLng))
        return .tilted(center, distance: min(max(span * 3, 1_300), 60_000), heading: 0, pitch: 45)
    }
}
