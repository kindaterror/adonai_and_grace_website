// == IMPORTS & DEPENDENCIES ==
import { QueryClient, QueryFunction } from "@tanstack/react-query";

// == HELPERS ==
async function safeParseJSON(res: Response): Promise<any> {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text }; // fallback if HTML or invalid JSON
  }
}

function toHttpError(res: Response, body: any): Error {
  const msg = body?.message || res.statusText || "Unknown error";
  const error = new Error(`${res.status} ${msg}`);
  (error as any).status = res.status;
  (error as any).body = body;
  return error;
}

// == API BASE URL ==
// Allow overriding via env to make the client configurable. If not provided,
// use the current origin (works for production) instead of hardcoding localhost.
// This prevents CSP violations when deployed.
const API_BASE_URL = (import.meta.env?.VITE_API_BASE_URL as string) || (typeof window !== 'undefined' ? window.location.origin : "");
if (import.meta.env?.MODE !== 'production') {
  // Helpful debug so we know what base URL the client picked up after build
  // (Will be stripped / tree-shaken in prod builds by terser if configured)
  console.log('[api] using base URL:', API_BASE_URL);
}

// == API REQUEST FUNCTION ==
export async function apiRequest<T = any>(
  method: string,
  url: string,
  data?: any,
  options?: RequestInit
): Promise<T> {
  let token: string | null = null;
  try { token = localStorage.getItem("token"); } catch { token = null; }

  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options?.headers || {}),
  };

  const fullUrl = url.startsWith("http") ? url : `${API_BASE_URL}${url}`;

  const res = await fetch(fullUrl, {
    method,
    credentials: "include",
    headers,
    body: data ? JSON.stringify(data) : undefined,
    ...options,
  });

  const parsed = await safeParseJSON(res);
  if (!res.ok) throw toHttpError(res, parsed);

  return parsed as T;
}

// == QUERY FUNCTION ==
type UnauthorizedBehavior = "returnNull" | "throw";

export const getQueryFn =
  <T>({ on401 }: { on401: UnauthorizedBehavior }): QueryFunction<T> =>
  async ({ queryKey }) => {
    const token = localStorage.getItem("token");

    const headers: HeadersInit = {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };

    const url = queryKey[0] as string;
    const res = await fetch(url, { credentials: "include", headers });

    if (on401 === "returnNull" && res.status === 401) {
      return null as unknown as T;
    }

    const parsed = await safeParseJSON(res);
    if (!res.ok) throw toHttpError(res, parsed);

    return parsed as T;
  };

// == QUERY CLIENT CONFIGURATION ==
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});