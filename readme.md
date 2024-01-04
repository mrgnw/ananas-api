
### Dev
```sh
wrangler dev --remote
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