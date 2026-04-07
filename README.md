# typefully-cli

JSON-first Bun + Effect CLI for the Typefully v2 API.

## Environment

```bash
export TYPEFULLY_API_KEY="tfy_..."
# optional, defaults to the public v2 API
export TYPEFULLY_API_BASE_URL="https://api.typefully.com/v2"
```

## JSON-first contract

- Mutation commands accept one JSON object or an array of objects.
- Input can be inline JSON, `@path/to/file.json`, or `-` for stdin.
- Success is written to `stdout` as:

```json
{
  "ok": true,
  "command": "drafts create",
  "data": {}
}
```

- Failures are written to `stderr` as:

```json
{
  "ok": false,
  "command": "media upload",
  "error": {
    "type": "MediaProcessingError",
    "message": "Typefully reported media processing failure",
    "details": {}
  }
}
```

- Presigned upload URLs are treated as secrets and are redacted from surfaced error envelopes.
- `drafts create`, `drafts update`, and `drafts delete` accept arrays and run them concurrently with `--concurrency <n>` (default `5`).
- PATCH payloads use **omit to leave unchanged** semantics. Prefer omission over `null`.
- `media upload` waits for `ready` by default. Set `wait_for_ready: false` to return right after the presigned PUT upload.

## Examples

```bash
# health / auth
bun run dev auth status
bun run dev me

# simple read flow
bun run dev social-sets list --limit 10 --offset 0

# single draft from a JSON file
bun run dev drafts create @examples/drafts/create-single.json

# batch draft creation with explicit concurrency control
bun run dev drafts create @examples/drafts/create-batch.json --concurrency 2

# batch draft update
bun run dev drafts update @examples/drafts/update-batch.json --concurrency 2

# post analytics for X in a date range
bun run dev analytics posts @examples/analytics/posts.json

# resolve a LinkedIn company URL into mention-ready metadata
bun run dev linkedin organizations resolve @examples/linkedin/organizations-resolve.json

# media upload with polling until ready
bun run dev media upload @examples/media/upload.json

# media upload that returns immediately after the raw PUT upload
bun run dev media upload '{"social_set_id":123,"file_path":"./image.png","wait_for_ready":false}'

# draft creation using the media_id returned by `media upload`
bun run dev drafts create @examples/drafts/create-with-media.json
```

Example draft payload with an uploaded attachment:

```json
{
  "social_set_id": 123,
  "platforms": {
    "x": {
      "enabled": true,
      "posts": [
        {
          "text": "Draft with an uploaded media attachment",
          "media_ids": ["media-id-from-media-upload"]
        }
      ]
    }
  }
}
```

`linkedin organizations resolve` returns a `mention_text` field. Paste that value directly into your LinkedIn draft text:

```json
{
  "id": "987654",
  "urn": "urn:li:organization:987654",
  "mention_text": "@[Typefully](urn:li:organization:987654)",
  "name": "Typefully",
  "url": "https://www.linkedin.com/company/typefullycom/"
}
```

Then use that `mention_text` value as-is in your draft payload:

```json
{
  "social_set_id": 123,
  "platforms": {
    "linkedin": {
      "enabled": true,
      "posts": [
        {
          "text": "Thanks @[Typefully](urn:li:organization:987654) for the support."
        }
      ]
    }
  }
}
```

## Agent workflow notes

- Prefer `@file` JSON inputs so prompts stay small and reproducible.
- Use array payloads for batch draft mutations when an agent can tolerate partial success.
- On batch failures, the CLI still returns a success envelope on `stdout` with per-item results and sets exit code `1` when any item fails.
- Media uploads follow the documented Typefully v2 flow: request a presigned URL, upload raw file bytes with a plain `PUT`, then poll `/media/{media_id}` until `ready`, `failed`, or timeout.
