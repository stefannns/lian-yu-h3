# Reusing the Google Cloud key with another project

This guide uses the Google Cloud **service-account JSON** already on this
computer. It sends Gemini requests through **Vertex AI**, so usage is charged
to the Google Cloud billing account attached to the chosen project. It does
not use the free Gemini / AI Studio API key.

Never copy the JSON file into a repository, browser code, a public folder, or
a client-side `NEXT_PUBLIC_*` variable.

## What the other project needs

1. The target Google Cloud project has billing enabled.
2. Enable the **Vertex AI API** (`aiplatform.googleapis.com`).
3. Grant the service account in the JSON file **Vertex AI User**
   (`roles/aiplatform.user`) on that project.
4. Install the Node authentication package:

```powershell
npm install google-auth-library
```

The service account is an application identity. Its email address is inside
the JSON file under `client_email`. Assign the role to that email, not only
to your personal Google account.

## Local environment setup

Put these values in the other project's `.env.local` file. Keep the JSON in
the existing safe local folder; use its full path.

```dotenv
GOOGLE_CLOUD_PROJECT=YOUR_GOOGLE_CLOUD_PROJECT_ID
GOOGLE_CLOUD_LOCATION=global
GOOGLE_APPLICATION_CREDENTIALS=C:/googlecloudkey/YOUR_SERVICE_ACCOUNT_FILE.json
```

Do not set `GEMINI_API_KEY` for this integration. If the project still has
one for a separate reason, make the Vertex transport explicit:

```dotenv
GEMINI_TRANSPORT=vertex
```

Restart the development server after changing `.env.local`.

## Minimal server-side Gemini text call

Create a server-only helper, for example `lib/vertex-gemini.ts`. Never
import it from a React client component.

```ts
import { GoogleAuth } from "google-auth-library";

const scope = "https://www.googleapis.com/auth/cloud-platform";

export async function generateText(prompt: string) {
  const project = process.env.GOOGLE_CLOUD_PROJECT;
  const location = process.env.GOOGLE_CLOUD_LOCATION ?? "global";
  if (!project) throw new Error("GOOGLE_CLOUD_PROJECT is missing.");

  const auth = new GoogleAuth({ scopes: [scope] });
  const token = (await (await auth.getClient()).getAccessToken()).token;
  if (!token) throw new Error("Could not obtain a Google Cloud access token.");

  const host =
    location === "global"
      ? "https://aiplatform.googleapis.com"
      : `https://${location}-aiplatform.googleapis.com`;
  const url =
    `${host}/v1/projects/${project}/locations/${location}` +
    "/publishers/google/models/gemini-2.5-flash:generateContent";

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    }),
  });

  if (!response.ok) throw new Error(`Vertex error ${response.status}: ${await response.text()}`);
  const body = await response.json();
  return body.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}
```

Use it only in a Next.js route handler, Server Action, or other server code:

```ts
import { NextResponse } from "next/server";
import { generateText } from "@/lib/vertex-gemini";

export async function POST() {
  return NextResponse.json({ text: await generateText("Say hello in Chinese.") });
}
```

## Optional: Nano Banana image generation

For a Vertex image model, use the same OAuth token and endpoint. With a model
available in the global location:

```dotenv
VERTEX_IMAGE_MODEL=gemini-3-pro-image
GOOGLE_CLOUD_LOCATION=global
```

The request body must ask for image output:

```ts
const response = await fetch(urlForImageModel, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  },
  body: JSON.stringify({
    contents: [{ role: "user", parts: [{ text: "A polished romantic game CG" }] }],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"],
      imageConfig: { aspectRatio: "16:9" },
    },
  }),
});
```

Read the returned image from
`candidates[0].content.parts[*].inlineData.data` (base64). Keep this work
server-side; send the final image URL or data to the browser, never the token
or the JSON.

## Quick checks

From the other project's terminal:

```powershell
node -e "const {GoogleAuth}=require('google-auth-library'); new GoogleAuth({scopes:['https://www.googleapis.com/auth/cloud-platform']}).getClient().then(c=>c.getAccessToken()).then(x=>console.log(x.token?'Google Cloud token available':'No token')).catch(e=>{console.error(e.message);process.exit(1)})"
```

If it prints `Google Cloud token available`, the local JSON path and
authentication are working. This does not generate content or incur model
charges.

## Common errors

| Message | Meaning | Fix |
| --- | --- | --- |
| `Could not load the default credentials` | The JSON path is wrong or the process was not restarted. | Check `GOOGLE_APPLICATION_CREDENTIALS` and restart the app. |
| HTTP 403 / missing `aiplatform.endpoints.predict` | The JSON's service account lacks Vertex permissions. | Grant that service account `roles/aiplatform.user` on the selected project. |
| HTTP 404 model not found | The model ID or region is wrong. | Check model availability and use its supported location; Nano Banana Pro uses `global`. |
| HTTP 401 | OAuth was not attached, or an API key was sent to a Vertex endpoint. | Use the bearer-token flow above. Vertex is not the AI Studio API-key endpoint. |
| Charges do not appear immediately | Cloud Billing reports can lag behind a request. | Wait for billing reporting to update and review the project’s Vertex / billing usage. |

## Security checklist

- Keep the JSON outside every repository.
- Add `.env.local` and any key folder to `.gitignore`.
- Do not log request headers, access tokens, or file contents.
- Give the service account only the roles it needs.
- If the JSON is exposed, delete that service-account key in Google Cloud IAM
  and create a replacement.

## Official references

- [Gemini API in Vertex AI quickstart](https://cloud.google.com/vertex-ai/generative-ai/docs/start/quickstart)
- [Application Default Credentials](https://cloud.google.com/docs/authentication/application-default-credentials)
- [Vertex AI IAM roles](https://cloud.google.com/vertex-ai/docs/general/access-control)
