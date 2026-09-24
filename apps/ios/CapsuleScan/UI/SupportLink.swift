import SwiftUI
import StoreKit

struct SupportLink: View {
    @State private var storefrontCountry: String?

    var body: some View {
        Group {
            // App Review 3.1.1(a) permits external payment links in the US
            // storefront without an entitlement. Don't infer this from locale.
            if storefrontCountry == "USA" {
                Link("support capsule", destination: URL(string: "https://buy.stripe.com/bJe4gA3nKao36B43M7enS03")!)
                    .frame(minHeight: 44)
            }
        }
        .task {
            storefrontCountry = await Storefront.current?.countryCode
            for await storefront in Storefront.updates {
                guard !Task.isCancelled else { return }
                storefrontCountry = storefront.countryCode
            }
        }
    }
}
