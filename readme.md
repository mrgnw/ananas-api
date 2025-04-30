
### Dev
```sh
wrangler dev
```

#### curl local dev

```sh
curl  http://localhost:8787
```


```sh
curl -X POST http://localhost:8787 \
-H "Content-Type: application/json" \
-d '{"text": "How do you do, fellow kids?", "src_lang": "en", "to_languages": ["es", "fr", "de"]}'

```

### Use the example pre-push hook
```sh
mkdir -p .git/hooks && \
	cp git-pre-push-hook .git/hooks/pre-push && \
	chmod +x .git/hooks/pre-commit
```

### Publish

```sh
#!/bin/zsh
wrangler deploy
```

```sh
 bunx wrangler deploy --env dev
 ```