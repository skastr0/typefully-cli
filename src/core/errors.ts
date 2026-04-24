import { Schema } from "effect"

export class ConfigurationError extends Schema.TaggedError<ConfigurationError>()(
  "ConfigurationError",
  {
    field: Schema.String,
    message: Schema.String,
  },
) {}

export class MissingApiKeyError extends Schema.TaggedError<MissingApiKeyError>()(
  "MissingApiKeyError",
  {
    envVar: Schema.String,
    hint: Schema.String,
  },
) {}

export class JsonInputError extends Schema.TaggedError<JsonInputError>()(
  "JsonInputError",
  {
    source: Schema.String,
    reason: Schema.String,
    message: Schema.String,
  },
) {}

export class CommandInputError extends Schema.TaggedError<CommandInputError>()(
  "CommandInputError",
  {
    field: Schema.String,
    message: Schema.String,
  },
) {}

export class ArtifactWriteError extends Schema.TaggedError<ArtifactWriteError>()(
  "ArtifactWriteError",
  {
    path: Schema.String,
    message: Schema.String,
  },
) {}

export class MediaFileError extends Schema.TaggedError<MediaFileError>()(
  "MediaFileError",
  {
    filePath: Schema.String,
    message: Schema.String,
  },
) {}

export class MediaUploadError extends Schema.TaggedError<MediaUploadError>()(
  "MediaUploadError",
  {
    filePath: Schema.String,
    uploadUrl: Schema.String,
    status: Schema.NullishOr(Schema.Number),
    message: Schema.String,
  },
) {}

export class MediaProcessingError extends Schema.TaggedError<MediaProcessingError>()(
  "MediaProcessingError",
  {
    socialSetId: Schema.Union(Schema.Number, Schema.String),
    mediaId: Schema.String,
    reason: Schema.NullishOr(Schema.Unknown),
    message: Schema.String,
  },
) {}

export class TypefullyRequestError extends Schema.TaggedError<TypefullyRequestError>()(
  "TypefullyRequestError",
  {
    method: Schema.String,
    path: Schema.String,
    reason: Schema.String,
    message: Schema.String,
  },
) {}

export class TypefullyApiError extends Schema.TaggedError<TypefullyApiError>()(
  "TypefullyApiError",
  {
    method: Schema.String,
    path: Schema.String,
    status: Schema.Number,
    message: Schema.String,
    body: Schema.NullishOr(Schema.Unknown),
  },
) {}

export class TypefullyDecodeError extends Schema.TaggedError<TypefullyDecodeError>()(
  "TypefullyDecodeError",
  {
    method: Schema.String,
    path: Schema.String,
    message: Schema.String,
  },
) {}

export type AppError =
  | ConfigurationError
  | MissingApiKeyError
  | JsonInputError
  | CommandInputError
  | ArtifactWriteError
  | MediaFileError
  | MediaUploadError
  | MediaProcessingError
  | TypefullyRequestError
  | TypefullyApiError
  | TypefullyDecodeError
