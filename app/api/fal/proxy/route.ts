import { route } from "@fal-ai/server-proxy/nextjs";

// Proxies all fal API traffic so FAL_KEY never reaches the browser.
export const { GET, POST, PUT } = route;
