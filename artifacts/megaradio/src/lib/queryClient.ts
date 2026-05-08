import { QueryClient, QueryFunction } from "@tanstack/react-query";

export const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

export function resolveApiUrl(path: string): string {
  if (!API_BASE || !path.startsWith('/api')) return path;
  return `${API_BASE}${path}`;
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  options: {
    body?: unknown;
    headers?: Record<string, string>;
    signal?: AbortSignal;
  } = {}
): Promise<Response> {
  const { body, headers = {}, signal } = options;

  const res = await fetch(url, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
    credentials: "include",
    signal,
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    // Handle different queryKey formats
    let url: string;
    if (queryKey.length === 1) {
      // Simple string endpoint
      url = queryKey[0] as string;
    } else if (queryKey.length === 2 && typeof queryKey[1] === 'object') {
      // Endpoint with query parameters
      const baseUrl = queryKey[0] as string;
      const params = queryKey[1] as Record<string, any>;
      const searchParams = new URLSearchParams();
      
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          searchParams.append(key, String(value));
        }
      });
      
      url = searchParams.toString() ? `${baseUrl}?${searchParams.toString()}` : baseUrl;
    } else if (queryKey.length === 2 && typeof queryKey[1] === 'string') {
      // Handle favorites endpoints with sort as direct string
      const baseUrl = queryKey[0] as string;
      const sortValue = queryKey[1] as string;
      
      if (baseUrl === '/api/user/favorites') {
        url = `${baseUrl}?sort=${sortValue}`;
      } else {
        url = queryKey.join("/") as string;
      }
    } else {
      // Fallback to join behavior for other cases
      url = queryKey.join("/") as string;
    }
    
    const res = await fetch(url, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    const data = await res.json();
    return data;
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1000, // 5 minutes for radio frontend
      gcTime: 10 * 60 * 1000, // 10 minutes cache
      retry: 1, // Retry once on failure
      refetchOnMount: false, // Use cache when available
      refetchOnReconnect: false, // Don't refetch on reconnect
    },
    mutations: {
      retry: 1,
    },
  },
});
