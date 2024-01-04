
### Dev
```sh
wrangler dev
```

#### curl local dev

```sh
curl  http://localhost:8787
```

```sh
TRANSLATE_TEXT="How do you do, fellow kids?"
curl -X POST http://localhost:8787 \
-H "Content-Type: application/json" \
-d '{"text": "$TRANSLATE_TEXT", "from_lang": "en", "to_languages": ["es", "fr", "de"]}'

```

### Git pre-push hook
```sh
mkdir -p .git/hooks && \
	touch .git/hooks/pre-push && \
	chmod +x .git/hooks/pre-commit
```


```sh
#!/bin/zsh
wrangler deploy
```
