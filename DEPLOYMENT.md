# Deploying the site and API separately

The frontend stays at the repository root for Cloudflare Pages. The Flask API lives in `backend/` and can be deployed as a separate Python web service.

## Deploy the API on Render

Create a Render Web Service connected to this repository and configure:

- Root Directory: `backend`
- Build Command: `pip install -r requirements.txt`
- Start Command: `gunicorn server:app --bind 0.0.0.0:$PORT`

After deployment, confirm that `https://YOUR-API-HOST/health` returns `{"status":"ok"}`. The `backend/Procfile` contains the same start command for hosts that use Procfiles.

## Connect Cloudflare Pages

The Pages Function at `functions/api/youtube/[[path]].js` forwards `/api/youtube/*` requests to the separate API service. In the Pages project, add the `API_ORIGIN` environment variable with the API origin, for example `https://YOUR-API-HOST` (no path suffix), then redeploy.

Cloudflare Pages Functions require a Git connected Pages project or a Wrangler deployment. Dashboard drag-and-drop uploads do not deploy the `functions/` directory. Keep the Pages project root at the repository root so Cloudflare can find `functions/`.

## Local development

Run `npm run dev`. It starts Vite and the Flask API together; Vite forwards `/api` requests to `http://localhost:8000`.
