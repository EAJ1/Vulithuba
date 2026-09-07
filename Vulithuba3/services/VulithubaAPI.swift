//import Foundation

final class VulithubaAPI {
    
    static let shared = VulithubaAPI()
    
    private let baseURL = "https://www.vulithuba.co.za/api"
    
    private init() {}
    
    func get<T: Decodable>(
        _ endpoint: String,
        token: String? = nil
    ) async throws -> T {
        
        guard let url = URL(string: baseURL + endpoint) else {
            throw APIError.invalidURL
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        
        if let token {
            request.setValue(
                "Bearer \(token)",
                forHTTPHeaderField: "Authorization"
            )
        }
        
        let (data, response) = try await URLSession.shared.data(for: request)
        
        try validateResponse(response)
        
        return try JSONDecoder().decode(T.self, from: data)
    }
    
    func post<T: Decodable, Body: Encodable>(
        _ endpoint: String,
        body: Body,
        token: String? = nil
    ) async throws -> T {
        
        guard let url = URL(string: baseURL + endpoint) else {
            throw APIError.invalidURL
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        
        if let token {
            request.setValue(
                "Bearer \(token)",
                forHTTPHeaderField: "Authorization"
            )
        }
        
        request.httpBody = try JSONEncoder().encode(body)
        
        let (data, response) = try await URLSession.shared.data(for: request)
        
        try validateResponse(response)
        
        return try JSONDecoder().decode(T.self, from: data)
    }
    
    private func validateResponse(_ response: URLResponse) throws {
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }
        
        guard 200...299 ~= httpResponse.statusCode else {
            throw APIError.httpError(httpResponse.statusCode)
        }
    }
}

enum APIError: LocalizedError {
    case invalidURL
    case invalidResponse
    case httpError(Int)
    
    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Invalid API URL."
        case .invalidResponse:
            return "Invalid server response."
        case .httpError(let statusCode):
            return "Server returned HTTP \(statusCode)."
        }
    }
}
//  VulithubaAPI.swift
//  Vulithuba3
//
//  Created by Africa Jarana on 2026/09/07.
//

