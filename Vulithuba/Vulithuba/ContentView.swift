import Combine
import SwiftUI

struct VulithubaUser: Codable {
    let username: String
    let email: String?
    let fullName: String?
    let phone: String?
    let address: String?
    let plan: String?
    let billingMethod: String?
    let billingStatus: String?
}

struct APIError: Codable {
    let error: String?
}

@MainActor
final class SessionStore: ObservableObject {
    @Published var user: VulithubaUser?
    @Published var isLoading = true
    @Published var errorMessage = ""

    private let baseURL = URL(string: "http://127.0.0.1:3000")!
    private let decoder = JSONDecoder()

    init() {
        Task { await loadSession() }
    }

    func loadSession() async {
        isLoading = true
        defer { isLoading = false }

        do {
            let response: MeResponse = try await request(path: "/api/me", method: "GET")
            user = response.user
        } catch {
            user = nil
        }
    }

    func login(username: String, password: String) async {
        errorMessage = ""
        do {
            let response: LoginResponse = try await request(
                path: "/api/login",
                method: "POST",
                body: ["username": username, "password": password]
            )
            _ = response
            await loadSession()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func logout() async {
        do {
            let _: EmptyResponse = try await request(path: "/api/logout", method: "POST")
        } catch {
            errorMessage = error.localizedDescription
        }
        user = nil
    }

    func changePassword(current: String, new: String, confirmation: String) async -> Bool {
        errorMessage = ""
        do {
            let response: MessageResponse = try await request(
                path: "/api/change-password",
                method: "POST",
                body: [
                    "currentPassword": current,
                    "newPassword": new,
                    "confirmPassword": confirmation
                ]
            )
            errorMessage = response.message ?? "Password changed. Please log in again."
            user = nil
            return true
        } catch {
            errorMessage = error.localizedDescription
            return false
        }
    }

    private func request<Response: Decodable>(
        path: String,
        method: String,
        body: [String: String]? = nil
    ) async throws -> Response {
        var request = URLRequest(url: baseURL.appending(path: path))
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpShouldHandleCookies = true
        if let body {
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw AppError.message("The server returned an invalid response.")
        }
        guard (200..<300).contains(httpResponse.statusCode) else {
            let apiError = try? decoder.decode(APIError.self, from: data)
            throw AppError.message(apiError?.error ?? "Request failed (\(httpResponse.statusCode)).")
        }
        return try decoder.decode(Response.self, from: data)
    }
}

private struct LoginResponse: Codable {
    let ok: Bool?
    let message: String?
}

private struct MeResponse: Codable {
    let user: VulithubaUser
}

private struct MessageResponse: Codable {
    let message: String?
}

private struct EmptyResponse: Codable {}

private enum AppError: LocalizedError {
    case message(String)

    var errorDescription: String? {
        switch self {
        case .message(let message): return message
        }
    }
}

struct ContentView: View {
    @StateObject private var session = SessionStore()

    var body: some View {
        Group {
            if session.isLoading {
                ProgressView("Loading Vulithuba...")
            } else if session.user == nil {
                LoginView(session: session)
            } else {
                DashboardView(session: session, user: session.user!)
            }
        }
        .tint(.blue)
    }
}

private struct LoginView: View {
    @ObservedObject var session: SessionStore
    @State private var username = ""
    @State private var password = ""
    @State private var isSubmitting = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    VStack(spacing: 10) {
                        Image(systemName: "antenna.radiowaves.left.and.right")
                            .font(.system(size: 44))
                            .foregroundStyle(.blue)
                        Text("Vulithuba")
                            .font(.largeTitle.bold())
                        Text("Smart connectivity for South Africa")
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 20)
                }

                Section("Sign in") {
                    TextField("Username", text: $username)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    SecureField("Password", text: $password)
                    Button(isSubmitting ? "Signing in..." : "Sign in") {
                        isSubmitting = true
                        Task {
                            await session.login(username: username, password: password)
                            isSubmitting = false
                        }
                    }
                    .disabled(username.isEmpty || password.isEmpty || isSubmitting)
                }

                if !session.errorMessage.isEmpty {
                    Text(session.errorMessage)
                        .foregroundStyle(.red)
                }

                Section {
                    Text("Forgot password? Use the reset page in the web app.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Welcome")
        }
    }
}

private struct DashboardView: View {
    @ObservedObject var session: SessionStore
    let user: VulithubaUser
    @State private var showingPasswordChange = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Label(user.fullName ?? user.username, systemImage: "person.crop.circle.fill")
                        .font(.headline)
                    Text(user.email ?? "No email on file")
                        .foregroundStyle(.secondary)
                }

                Section("Your service") {
                    DetailRow(title: "Plan", value: user.plan ?? "Not selected")
                    DetailRow(title: "Billing", value: user.billingStatus ?? "Pending")
                    DetailRow(title: "Payment method", value: user.billingMethod ?? "Not selected")
                }

                Section("Account") {
                    Button("Change password") {
                        showingPasswordChange = true
                    }
                    Button("Refresh account") {
                        Task { await session.loadSession() }
                    }
                    Button("Sign out", role: .destructive) {
                        Task { await session.logout() }
                    }
                }
            }
            .navigationTitle("Dashboard")
            .sheet(isPresented: $showingPasswordChange) {
                ChangePasswordView(session: session)
            }
        }
    }
}

private struct DetailRow: View {
    let title: String
    let value: String

    var body: some View {
        HStack {
            Text(title)
            Spacer()
            Text(value)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.trailing)
        }
    }
}

private struct ChangePasswordView: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var session: SessionStore
    @State private var currentPassword = ""
    @State private var newPassword = ""
    @State private var confirmPassword = ""
    @State private var isSubmitting = false

    var body: some View {
        NavigationStack {
            Form {
                SecureField("Current password", text: $currentPassword)
                SecureField("New password", text: $newPassword)
                SecureField("Confirm new password", text: $confirmPassword)

                Button(isSubmitting ? "Changing..." : "Change password") {
                    isSubmitting = true
                    Task {
                        let changed = await session.changePassword(
                            current: currentPassword,
                            new: newPassword,
                            confirmation: confirmPassword
                        )
                        isSubmitting = false
                        if changed { dismiss() }
                    }
                }
                .disabled(currentPassword.isEmpty || newPassword.isEmpty || confirmPassword.isEmpty || isSubmitting)

                if !session.errorMessage.isEmpty {
                    Text(session.errorMessage)
                        .foregroundStyle(.red)
                }
            }
            .navigationTitle("Change password")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
    }
}

#Preview {
    ContentView()
}
