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
printf '%s' "tfy_..." | typefully auth set
# or export an env key for this process; env takes precedence over stored auth
export TYPEFULLY_API_KEY="tfy_..."
# optional, defaults to the public v2 API
export TYPEFULLY_API_BASE_URL="https://api.typefully.com/v2"
# optional, defaults to ~/.typefully
export TYPEFULLY_HOME="$HOME/.typefully"
# optional, defaults to ~/.typefully/auth.json
export TYPEFULLY_AUTH_PATH="$HOME/.typefully/auth.json"
# optional, defaults to ~/.typefully/cache
export TYPEFULLY_CACHE_DIR="$HOME/.typefully/cache"
# optional, defaults to ~/.typefully/artifacts
export TYPEFULLY_ARTIFACT_DIR="$HOME/.typefully/artifacts"
```

## JSON-first contract

- Mutation commands accept one JSON object or an array of objects.
- Input can be inline JSON, `@path/to/file.json`, or `-` for stdin.
- Domain filters and query controls belong in JSON payloads. Flags are reserved for execution controls such as `--concurrency` and `--output`.
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
- Batch mutation results include `outcome`, counts, `concurrency`, ordered `results`, and per-item `target` identifiers. The process exits with code `1` if any item fails.
- PATCH payloads use **omit to leave unchanged** semantics. Prefer omission over `null`.
- Potentially large reads support `--output inline|artifact|auto`. Artifact mode writes JSON under `~/.typefully/artifacts` by default; set `TYPEFULLY_ARTIFACT_DIR` to override it.
- Discovery commands expose the machine contract: `capabilities`, `doctor`, `schema list/show`, and `examples list/show`.
- Typefully v2 does not expose documented idempotency keys. The CLI does not emulate durable mutation idempotency because doing so would overstate retry safety for create/update/delete calls.
- `media upload` waits for `ready` by default. Set `wait_for_ready: false` to return right after the presigned PUT upload.

Batch result shape:

```json
{
  "outcome": "partial_failure",
  "total": 2,
  "success_count": 1,
  "error_count": 1,
  "concurrency": 2,
  "results": [
    {
      "index": 0,
      "ok": true,
      "target": { "social_set_id": 123, "draft_id": 987 },
      "data": {}
    },
    {
      "index": 1,
      "ok": false,
      "target": { "social_set_id": 123, "draft_id": 654 },
      "error": {
        "type": "TypefullyApiError",
        "message": "Validation failed",
        "details": {
          "method": "PATCH",
          "path": "/social-sets/123/drafts/654",
          "status": 422,
          "retryable": false,
          "target": { "index": 1, "social_set_id": 123, "draft_id": 654 }
        }
      }
    }
  ]
}
```

## Commands

### `doctor`

Inspect local runtime, API key, base URL, and Typefully auth readiness.

```bash
typefully doctor
```

### `capabilities`

Describe supported commands, protocol conventions, batch behavior, output modes, and idempotency status.

```bash
typefully capabilities
```

### `schema list` / `schema show`

List and inspect JSON input schemas derived from the same Effect schemas used for validation.

```bash
typefully schema list
typefully schema show drafts.create
```

### `examples list` / `examples show`

List and inspect executable examples.

```bash
typefully examples list
typefully examples show "analytics posts"
```

### `auth path` / `auth set` / `auth import-env` / `auth status`

Save and inspect local auth, then check whether the configured API key works against Typefully v2. The local auth file defaults to `~/.typefully/auth.json`; its parent directory is created with `0700` permissions and the auth file is written with `0600` permissions.

```bash
typefully auth path
printf '%s' "tfy_..." | typefully auth set
TYPEFULLY_API_KEY="tfy_..." typefully auth import-env
typefully auth local-status
typefully auth status
```

### `me`

Fetch the current Typefully account via `/v2/me`.

```bash
typefully me
```

### `social-sets list`

List social sets from a JSON payload with optional `limit` and `offset`.

```bash
typefully social-sets list @examples/social-sets/list.json
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
typefully drafts list @examples/drafts/list.json --output artifact
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
typefully queue get @examples/queue/get.json --output auto
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
typefully analytics posts @examples/analytics/posts.json --output artifact
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
typefully media upload @examples/media/upload-no-wait.json
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
- Use `schema show <command-id>` before generating payloads and `examples show <command-id>` for copy-pastable argument shapes.
- Use `--output artifact` for list/analytics/queue/media diagnostic responses that are too large to keep inline. Artifacts default to `~/.typefully/artifacts`; set `TYPEFULLY_ARTIFACT_DIR` to override.
- Expected failures include structured recovery fields such as `hint`, `retryable`, provider `method`/`path`/`status`, and batch `target` IDs.
- Treat `drafts create` retries carefully. Without provider idempotency support, a retry after an unknown network result can create duplicates.
- Media uploads follow the documented Typefully v2 flow: request a presigned URL, upload raw file bytes with a plain `PUT`, then poll `/media/{media_id}` until `ready`, `failed`, or timeout.

## License

[MIT](LICENSE)
