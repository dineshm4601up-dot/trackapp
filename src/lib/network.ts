/** A failed request (offline, dropped connection) rather than a server-side error. */
export function isNetworkError(error: unknown) {
  return error instanceof TypeError;
}

export const NETWORK_ERROR_MESSAGE =
  "Couldn't reach the server. Check your connection and try again — nothing was lost.";
