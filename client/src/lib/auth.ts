// == IMPORTS & DEPENDENCIES ==
import { queryClient } from "./queryClient";
import { apiRequest } from "./queryClient";

// == TYPE DEFINITIONS ==
interface User {
  id: number;
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  gradeLevel?: string;
}

interface AuthResponse {
  user: User;
  token: string;
  message: string;
  requiresApproval?: boolean;
  emailSent?: boolean;
}

// == AUTHENTICATION FUNCTIONS ==
export async function loginUser(email: string, password: string): Promise<AuthResponse> {
  if (!email || !password) throw new Error("Missing credentials");
  const data = await apiRequest<AuthResponse>("POST", "/api/auth/login", { email, password });

  try {
    if (data?.token) localStorage.setItem("token", String(data.token));
  } catch {
    // ignore localStorage write failures (e.g., in private mode)
  }

  return data;
}

export async function registerUser(userData: {
  username: string;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role?: string;
  gradeLevel?: string;
  securityQuestion?: string;
  securityAnswer?: string;
}): Promise<AuthResponse> {
  try {
    const data = await apiRequest<AuthResponse>("POST", "/api/auth/register", userData);
    
    try {
      if (data?.token) {
        localStorage.setItem("token", String(data.token));
      } else {
        try { localStorage.removeItem("token"); } catch {}
      }
    } catch {
      // ignore storage errors
    }
    
    return data;
  } catch (error) {
    console.error("Registration error:", error);
    throw error;
  }
}

export function logoutUser(): void {
  try { localStorage.removeItem("token"); } catch {}
  queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
  queryClient.clear();
}

// == UTILITY FUNCTIONS ==
export function getAuthToken(): string | null {
  try { return localStorage.getItem("token"); } catch { return null; }
}

export function isAuthenticated(): boolean {
  return !!getAuthToken();
}

export function getAuthHeaders(): HeadersInit {
  const token = getAuthToken();
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}