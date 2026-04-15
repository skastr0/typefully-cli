# typefully-cli

JSON-first Bun + Effect CLI for the [Typefully v2 API](https://support.typefully.com/en/articles/8764053-the-typefully-api).

## Requirements

- [Bun](https://bun.sh) >= 1.3

## Install

```bash
# clone and build
git clone https://github.com/skastr0/typefully-cli.git
cd typefully-cli
bun install
bun run build

# install the binary to ~/.local/bin
bun run install:local
```

Or run directly without installing:

```bash
bun run dev <command>
```

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

## Commands

### `auth status`

Check whether the configured API key works against Typefully v2.

```bash
typefully auth status
```

### `me`

Fetch the current Typefully account via `/v2/me`.

```bash
typefully me
```

### `social-sets list`

List social sets. Uses `--limit` and `--offset` options (not JSON input).

```bash
typefully social-sets list --limit 10 --offset 0
```

### `social-sets get`

Get a single social set by ID.

```bash
typefully social-sets get @examples/social-sets/get.json
```

### `tags list`

List tags for a social set.

```bash
typefully tags list @examples/tags/list.json
```

### `tags create`

Create a tag for a social set.

```bash
typefully tags create @examples/tags/create.json
```

### `drafts list`

List drafts from a JSON input object containing `social_set_id` and optional filters (`status`, `tag`, `order_by`, `limit`, `offset`).

```bash
typefully drafts list @examples/drafts/list.json
```

### `drafts get`

Get a single draft by `social_set_id` and `draft_id`.

```bash
typefully drafts get @examples/drafts/get.json
```

### `drafts create`

Create one or more drafts. Accepts a single object or an array.

```bash
# single draft from a JSON file
typefully drafts create @examples/drafts/create-single.json

# batch creation with explicit concurrency control
typefully drafts create @examples/drafts/create-batch.json --concurrency 2
```

### `drafts update`

Update one or more drafts. Accepts a single object or an array.

```bash
typefully drafts update @examples/drafts/update-batch.json --concurrency 2
```

### `drafts delete`

Delete one or more drafts. Accepts a single object or an array.

```bash
typefully drafts delete @examples/drafts/delete-batch.json --concurrency 2
```

### `queue get`

Get queue slots and scheduled drafts for a date range.

```bash
typefully queue get @examples/queue/get.json
```

### `queue schedule get`

Get queue schedule rules for a social set.

```bash
typefully queue schedule get @examples/queue/schedule-get.json
```

### `queue schedule update`

Replace queue schedule rules for a social set.

```bash
typefully queue schedule update @examples/queue/schedule-update.json
```

### `analytics posts`

Get analytics posts for a social set, platform, and date range.

```bash
typefully analytics posts @examples/analytics/posts.json
```

### `linkedin organizations resolve`

Resolve a LinkedIn company URL into mention-ready metadata.

```bash
typefully linkedin organizations resolve @examples/linkedin/organizations-resolve.json
```

Returns a `mention_text` field you can paste directly into LinkedIn draft text:

```json
{
  "id": "987654",
  "urn": "urn:li:organization:987654",
  "mention_text": "@[Typefully](urn:li:organization:987654)",
  "name": "Typefully",
  "url": "https://www.linkedin.com/company/typefullycom/"
}
```

### `media upload`

Upload a local file. Waits for `ready` by default.

```bash
# upload and wait for processing to complete
typefully media upload @examples/media/upload.json

# return immediately after the raw PUT upload
typefully media upload '{"social_set_id":123,"file_path":"./image.png","wait_for_ready":false}'
```

Use the returned `media_id` in draft creation:

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

## Agent workflow notes

- Prefer `@file` JSON inputs so prompts stay small and reproducible.
- Use array payloads for batch draft mutations when an agent can tolerate partial success.
- On batch failures, the CLI still returns a success envelope on `stdout` with per-item results and sets exit code `1` when any item fails.
- Media uploads follow the documented Typefully v2 flow: request a presigned URL, upload raw file bytes with a plain `PUT`, then poll `/media/{media_id}` until `ready`, `failed`, or timeout.

## License

[MIT](LICENSE)
