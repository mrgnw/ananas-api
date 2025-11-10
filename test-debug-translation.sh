#!/bin/bash

# Test script to debug "Que pedo güey!!" translation issue
BASE_URL="${1:-http://localhost:8787}"

echo "🔍 Testing: Que pedo güey!! translation"
echo "========================================"
echo ""

echo "Test 1: WITH src_lang=spa (default mode - clean)"
echo "-------------------------------------------"
curl -s -X POST "${BASE_URL}/multi" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Que pedo güey!!",
    "src_lang": "spa",
    "tgt_langs": ["eng"]
  }' | jq

echo ""
echo ""
echo "Test 2: WITH src_lang=spa (verbose mode - debugging)"
echo "-------------------------------------------"
curl -s -X POST "${BASE_URL}/multi" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Que pedo güey!!",
    "src_lang": "spa",
    "tgt_langs": ["eng"],
    "verbose": true
  }' | jq

echo ""
echo ""
echo "Test 3: WITHOUT src_lang (auto-detect, verbose mode)"
echo "-------------------------------------------"
curl -s -X POST "${BASE_URL}/multi" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Que pedo güey!!",
    "tgt_langs": ["eng"],
    "verbose": true
  }' | jq

echo ""
echo ""
echo "Test 4: Google translator only (if configured)"
echo "-------------------------------------------"
curl -s -X POST "${BASE_URL}/google" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Que pedo güey!!",
    "tgt_langs": ["eng"]
  }' | jq

echo ""
echo ""
echo "Test 5: M2M translator only"
echo "-------------------------------------------"
curl -s -X POST "${BASE_URL}/m2m" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Que pedo güey!!",
    "src_lang": "spa",
    "tgt_langs": ["eng"]
  }' | jq
