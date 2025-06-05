# Google Translate Integration

This document describes the Google Translate integration that has been added to the ananas-api project.

## Overview

Google Translate has been integrated as one of the translation services available in the multi-translator system. It can be used alongside DeepL, M2M (Cloudflare Workers AI), and OpenAI translators.

## Setup

### Environment Variables

To use Google Translate, you need to configure the following environment variables:

```bash
GOOGLE_CLOUD_PROJECT_ID=your-google-cloud-project-id
GOOGLE_TRANSLATE_ACCESS_TOKEN=$(gcloud auth print-access-token)
```

### Getting Google Cloud Credentials

1. **Create a Google Cloud Project**: Go to the [Google Cloud Console](https://console.cloud.google.com/) and create a new project or select an existing one.
2. **Enable the Cloud Translation API**: Navigate to the API Library and enable the Cloud Translation API for your project.



```sh
GOOGLE_CLOUD_PROJECT_ID=$(gcloud config get-value project)
```

```sh
GOOGLE_TRANSLATE_ACCESS_TOKEN=$(gcloud auth print-access-token)
```



## Usage

### Direct Google Translate Endpoint

Send a POST request to `/google` with the following format:

```json
{
  "text": "Hello world",
  "tgt_langs": ["spa", "fra", "deu"],
  "src_lang": "eng"
}
```

### Multi-Translator Endpoint

Google Translate is automatically included in the multi-translator system. Send a POST request to `/multi`:

```json
{
  "text": "Hello world",
  "tgt_langs": ["spa", "fra", "deu", "ita", "por"]
}
```

The system will automatically assign languages to the best available translator based on the priority order: `['deepl', 'google', 'm2m', 'openai']`.

## Language Support

Google Translate supports 198+ languages using ISO 639-3 language codes. The system includes comprehensive language mapping between:

- ISO 639-3 codes (used internally)
- Google Translate language codes
- Other translator format conversions

## Integration Details

### File Structure

- `src/google_translator.js` - Main Google Translate implementation
- `src/google-translate-support.json` - Language support mapping
- `src/lang_utils.js` - Updated with Google Translate support
- `src/multi_translator.js` - Updated to include Google Translate
- `src/index.js` - Added `/google` route

### Priority Order

In the multi-translator system, the default priority order is:
1. DeepL (high quality, limited languages)
2. Google Translate (high quality, extensive language support)
3. M2M/Cloudflare AI (good quality, broad support)
4. OpenAI (fallback for unsupported languages)

### Error Handling

The Google Translate integration includes comprehensive error handling for:
- Missing credentials
- Unsupported languages
- API errors
- Network issues

### Response Format

Responses follow the same format as other translators:

```json
{
  "eng": "Hello world",
  "spa": "Hola mundo",
  "fra": "Bonjour le monde",
  "metadata": {
    "src_lang": "eng",
    "language_definition": "user",
    "translator": "google",
    "detected_source_language": "eng"
  },
  "errors": {
    "unsupported_target_langs": []
  }
}
```

## Testing

The integration includes comprehensive tests and can be tested using the existing multi-translator test suite or by directly calling the `/google` endpoint.

## Notes

- Google Translate API v3 requires OAuth authentication (Bearer tokens)
- The API does not support API keys like v2
- Tokens need to be refreshed periodically
- The implementation handles automatic language detection when no source language is provided
- Regional variants are supported (e.g., zh-CN, zh-TW, pt-BR, pt-PT)
