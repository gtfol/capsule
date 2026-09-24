import SwiftUI

private enum LibraryTab: String, CaseIterable, Identifiable {
    case wardrobe, wishlist, outfits
    var id: String { rawValue }
}

@MainActor struct WardrobeView: View {
    @EnvironmentObject private var services: AppServices
    @Environment(\.scenePhase) private var scenePhase
    @State private var capture = false
    @State private var collection: LibraryTab = .wardrobe
    @State private var newOutfit = false
    @State private var newWishlistItem: RemoteWardrobeItem?
    var body: some View {
        NavigationStack {
            Group {
                if !services.credentialsReady { ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity) }
                else if let client = services.wardrobe, let user = services.user {
                    if collection == .wardrobe {
                        WardrobeGrid(client: client, collection: .wardrobe, add: { capture = true }).id(user.id + collection.rawValue)
                    } else if collection == .outfits {
                        if let outfits = services.outfits {
                            OutfitsView(client: outfits, wardrobe: client, creating: $newOutfit).id(user.id)
                        } else {
                            VStack(spacing: 16) { Text("sign in again to connect your outfits.").font(CapsuleStyle.caption); SignInButton() }.frame(maxWidth: .infinity, maxHeight: .infinity)
                        }
                    } else if let wishlist = services.wishlist {
                        WardrobeGrid(client: wishlist, collection: .wishlist, add: { newWishlistItem = .empty() }).id(user.id + collection.rawValue)
                    } else {
                        VStack(spacing: 16) {
                            Text("sign in again to connect your wishlist.").font(CapsuleStyle.caption)
                            SignInButton()
                        }.frame(maxWidth: .infinity, maxHeight: .infinity)
                    }
                } else {
                    VStack(spacing: 20) {
                        Text("capsule").font(CapsuleStyle.heading)
                        SignInButton().capsulePrimaryAction()
                        if let message = services.connectionMessage { Text(message).font(CapsuleStyle.caption).foregroundStyle(CapsuleStyle.secondary) }
                    }.padding(20).frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .capsuleScreen()
            .navigationTitle(collection.rawValue)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) { Text(collection.rawValue).font(CapsuleStyle.heading) }
                ToolbarItem(placement: .topBarLeading) {
                    NavigationLink { SettingsView() } label: { Image(systemName: "gearshape").font(.system(size: 15)).frame(width: 44, height: 44) }.accessibilityLabel("settings")
                }.quietBackground()
                ToolbarItem(placement: .topBarTrailing) {
                    Button { if collection == .outfits { newOutfit = true } else if collection == .wishlist { newWishlistItem = .empty() } else { capture = true } } label: { Image(systemName: "plus").font(.system(size: 16)).frame(width: 44, height: 44) }.accessibilityLabel("add to \(collection.rawValue)").disabled(!services.connected || (collection == .wishlist && !services.wishlistEnabled) || (collection == .outfits && !services.outfitsEnabled))
                }.quietBackground()
            }
            .safeAreaInset(edge: .bottom) {
                if services.connected {
                    HStack(spacing: 32) {
                        ForEach(LibraryTab.allCases) { tab in
                            Button { collection = tab } label: {
                                Text(tab.rawValue).font(CapsuleStyle.caption)
                                    .foregroundStyle(collection == tab ? CapsuleStyle.text : CapsuleStyle.secondary).frame(minHeight: 44)
                            }.buttonStyle(.plain).accessibilityAddTraits(collection == tab ? .isSelected : [])
                        }
                    }.frame(maxWidth: .infinity).background(CapsuleStyle.canvas)
                }
            }
            .sheet(item: $newWishlistItem, onDismiss: { services.wardrobeReloadID = UUID() }) { item in
                if let client = services.wishlist {
                    NavigationStack {
                        WardrobeDetailView(model: WardrobeDetailModel(item: item, client: client, images: services.images, isolation: services.isolation, collection: .wishlist, analytics: services.analytics), client: client)
                    }
                }
            }
            .sheet(isPresented: $capture) {
                CaptureView(inWardrobe: true, onUploaded: { capture = false })
            }
            .task { await services.refreshCredentials(); services.analytics.track(.screen(.wardrobe)) }
            .onChange(of: collection) { _, tab in
                if let screen = AnalyticsScreen(rawValue: tab.rawValue) { services.analytics.track(.screen(screen)) }
            }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active { Task { await services.refreshCredentials(); services.wardrobeReloadID = UUID() } }
            }
        }
    }
}

@MainActor private struct WardrobeGrid: View {
    @EnvironmentObject private var services: AppServices
    @StateObject private var model = WardrobeModel()
    @State private var category: GarmentCategory?
    @State private var selected: RemoteWardrobeItem?
    @State private var sort: WishlistSort = .recent
    let client: any WardrobeServing
    let collection: CapsuleCollection
    let add: () -> Void
    private var filtered: [RemoteWardrobeItem] { sort.sorted(model.items.filter { category == nil || $0.category == category }) }
    var body: some View {
        VStack(spacing: 0) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 24) {
                    categoryButton("all", value: nil)
                    ForEach(GarmentCategory.allCases) { categoryButton($0.rawValue, value: $0) }
                }.padding(.horizontal, 20)
            }
            if collection == .wishlist {
                HStack {
                    Spacer()
                    Menu {
                        Picker("sort", selection: $sort) { ForEach(WishlistSort.allCases) { Text($0.rawValue).tag($0) } }
                    } label: { Label(sort.rawValue, systemImage: "arrow.up.arrow.down").font(CapsuleStyle.caption).frame(minHeight: 44) }
                }.padding(.horizontal, 20)
            }
            if let error = model.error {
                VStack(spacing: 8) {
                    Text(error).font(CapsuleStyle.caption).foregroundStyle(CapsuleStyle.secondary)
                    if model.needsSignIn { SignInButton() }
                    else { Button("try again") { Task { await model.load(client: client) } }.font(CapsuleStyle.caption) }
                }.padding(20)
            }
            ScrollView {
                if model.loading && !model.loaded { ProgressView().padding(.top, 48) }
                else if model.loaded && filtered.isEmpty {
                    VStack(spacing: 12) {
                        Text(category == nil ? "your \(collection.rawValue) is empty" : "no \(category!.rawValue) yet").font(CapsuleStyle.heading)
                        Button("add an item", action: add).font(CapsuleStyle.body).frame(minHeight: 44)
                    }.frame(maxWidth: .infinity).padding(.top, 48)
                } else {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 140), spacing: 16)], alignment: .leading, spacing: 24) {
                        ForEach(filtered) { item in
                            Button { selected = item } label: {
                                VStack(alignment: .leading, spacing: 6) {
                                    WardrobePhoto(item: item, view: item.primaryView, client: client, collection: collection)
                                        .aspectRatio(3 / 4, contentMode: .fit)
                                    Text(item.name).font(CapsuleStyle.body).lineLimit(2)
                                    if collection == .wishlist {
                                        HStack {
                                            Text(WishlistDisplay.price(item.price, currency: item.currency)).font(CapsuleStyle.caption)
                                            if item.link_broken == true { Image(systemName: "exclamationmark.triangle").font(.system(size: 12)).accessibilityLabel("listing unavailable") }
                                        }
                                        RatingStars(rating: item.rating).font(.system(size: 11))
                                    }
                                    Text(item.brand.isEmpty ? item.category.rawValue : item.brand).font(CapsuleStyle.caption).foregroundStyle(CapsuleStyle.secondary).lineLimit(1)
                                }.frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
                            }.buttonStyle(.plain)
                        }
                    }.padding(.horizontal, 20).padding(.top, 20).padding(.bottom, 32)
                }
            }
            .refreshable { await model.load(client: client, refreshPhotos: true) }
        }
        .task(id: services.wardrobeReloadID) { await model.load(client: client) }
        .sheet(item: $selected, onDismiss: { services.wardrobeReloadID = UUID() }) { item in
            NavigationStack {
                WardrobeDetailView(model: WardrobeDetailModel(item: item, client: client, images: services.images, isolation: services.isolation, collection: collection, analytics: services.analytics), client: client)
            }
        }
        .onChange(of: model.photoReloadID) { _, _ in
            if let account = services.user?.id { PhotoRefreshState.shared.refresh(account: account, collection: collection.rawValue) }
        }
    }
    private func categoryButton(_ title: String, value: GarmentCategory?) -> some View {
        Button { category = value } label: {
            Text(title).font(CapsuleStyle.caption).foregroundStyle(category == value ? CapsuleStyle.text : CapsuleStyle.secondary).frame(minHeight: 44)
        }.buttonStyle(.plain).accessibilityAddTraits(category == value ? .isSelected : [])
    }
}

@MainActor struct WardrobePhoto: View {
    let item: RemoteWardrobeItem
    let view: GarmentView
    let client: any WardrobeServing
    var collection: CapsuleCollection = .wardrobe
    var maxPixelSize = 600
    var body: some View {
        if item.hasPhoto(view) {
            RemotePhoto(collection: collection.rawValue, identity: "\(item.id):\(view.rawValue)",
                        revision: "\(item.revision):\(item.updatedAt):\(item.photoURL(view))", label: "\(item.name), \(view.rawValue)", maxPixelSize: maxPixelSize) {
                try await client.photo(item: item, view: view)
            }
        } else {
            Text("no photo").font(CapsuleStyle.caption).foregroundStyle(CapsuleStyle.secondary).frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}
