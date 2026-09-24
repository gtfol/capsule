import AuthenticationServices
import UIKit
import SwiftUI

@MainActor protocol BrowserAuthenticating {
    func authenticate(url: URL, callbackScheme: String) async throws -> URL
}
@MainActor final class BrowserSignIn: NSObject, BrowserAuthenticating, ASWebAuthenticationPresentationContextProviding {
    private var session: ASWebAuthenticationSession?
    private var pending: CheckedContinuation<URL, Error>?
    func authenticate(url: URL, callbackScheme: String) async throws -> URL {
        guard session == nil else { throw SignInError.unavailable }
        return try await withCheckedThrowingContinuation { continuation in
            pending = continuation
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: callbackScheme) { [weak self] callback, error in
                Task { @MainActor in
                    if let callback { self?.finish(.success(callback)) }
                    else if (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin { self?.finish(.failure(SignInError.cancelled)) }
                    else { self?.finish(.failure(SignInError.unavailable)) }
                }
            }
            self.session = session
            session.presentationContextProvider = self
            if !session.start() { finish(.failure(SignInError.unavailable)) }
        }
    }
    private func finish(_ result: Result<URL, Error>) {
        guard let continuation = pending else { return }
        pending = nil; session = nil
        continuation.resume(with: result)
    }
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows).first(where: \.isKeyWindow) ?? ASPresentationAnchor()
    }
}
struct SignInButton: View {
    @EnvironmentObject private var services: AppServices
    var body: some View {
        Button { Task { await services.signIn() } } label: {
            HStack { if services.authenticating { ProgressView() }; Text(services.authenticating ? "signing in…" : "sign in to capsule") }
        }.disabled(services.authenticating)
    }
}
