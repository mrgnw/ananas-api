#!/bin/bash

# Integration test script for ananas-api using curl
# Usage: ./integration-test.sh [BASE_URL]

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Default settings
BASE_URL="${1:-http://localhost:8787}"
TEST_TEXT="Hello world"
TARGET_LANGS='["spa", "fra", "deu"]'

echo -e "${BOLD}🚀 Starting API Integration Tests${NC}"
echo -e "${CYAN}📍 Base URL: ${BASE_URL}${NC}"
echo -e "${CYAN}📝 Test Text: \"${TEST_TEXT}\"${NC}"
echo -e "${CYAN}🎯 Target Languages: Spanish, French, German${NC}"

# Counters
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

# Test function
test_endpoint() {
    local endpoint="$1"
    local method="$2"
    local payload="$3"
    local description="$4"
    
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
    
    echo
    echo -e "${BOLD}$(printf '=%.0s' {1..60})${NC}"
    echo -e "${CYAN}📡 Testing ${description}...${NC}"
    echo -e "${BLUE}   Endpoint: ${method} ${BASE_URL}${endpoint}${NC}"
    
    if [ "$method" = "POST" ] && [ -n "$payload" ]; then
        echo -e "${BLUE}   Payload: ${payload}${NC}"
        response=$(curl -s -w "HTTPSTATUS:%{http_code}" \
            -X POST \
            -H "Content-Type: application/json" \
            -d "$payload" \
            "${BASE_URL}${endpoint}" 2>/dev/null)
    else
        response=$(curl -s -w "HTTPSTATUS:%{http_code}" \
            -X "$method" \
            "${BASE_URL}${endpoint}" 2>/dev/null)
    fi
    
    # Extract HTTP status and body
    http_code=$(echo "$response" | grep -o "HTTPSTATUS:[0-9]*" | cut -d: -f2)
    body=$(echo "$response" | sed 's/HTTPSTATUS:[0-9]*$//')
    
    if [ -z "$http_code" ]; then
        echo -e "${RED}   💥 Connection failed - is the server running?${NC}"
        FAILED_TESTS=$((FAILED_TESTS + 1))
        return 1
    fi
    
    if [ "$http_code" -ge 200 ] && [ "$http_code" -lt 300 ]; then
        echo -e "${GREEN}   ✅ Success (${http_code})${NC}"
        PASSED_TESTS=$((PASSED_TESTS + 1))
        
        # Pretty print JSON if possible
        if command -v jq >/dev/null 2>&1; then
            echo -e "${GREEN}   Response:${NC}"
            echo "$body" | jq . 2>/dev/null | sed 's/^/     /' || echo "     $body"
        else
            echo -e "${GREEN}   Response: ${body}${NC}"
        fi
    else
        echo -e "${RED}   ❌ Failed (${http_code})${NC}"
        echo -e "${RED}   Error: ${body}${NC}"
        FAILED_TESTS=$((FAILED_TESTS + 1))
    fi
}

# Quick connectivity test
echo
echo -e "${CYAN}🔗 Testing basic connectivity...${NC}"
if curl -s --max-time 5 "${BASE_URL}" >/dev/null 2>&1; then
    echo -e "${GREEN}   Connection successful!${NC}"
else
    echo -e "${RED}   ❌ Cannot connect to ${BASE_URL}${NC}"
    echo -e "${YELLOW}   Make sure the development server is running with: bun run dev${NC}"
    exit 1
fi

# Test 1: GET Health Check
test_endpoint "/" "GET" "" "GET Health Check"

# Test 2: M2M Translator
test_endpoint "/m2m" "POST" \
    "{\"text\": \"${TEST_TEXT}\", \"tgt_langs\": ${TARGET_LANGS}}" \
    "M2M Translator"

# Test 3: DeepL Translator
test_endpoint "/deepl" "POST" \
    "{\"text\": \"${TEST_TEXT}\", \"tgt_langs\": ${TARGET_LANGS}}" \
    "DeepL Translator"

# Test 4: Google Translator
test_endpoint "/google" "POST" \
    "{\"text\": \"${TEST_TEXT}\", \"tgt_langs\": ${TARGET_LANGS}}" \
    "Google Translator"

# Test 5: OpenAI Translator
test_endpoint "/openai" "POST" \
    "{\"text\": \"${TEST_TEXT}\", \"tgt_langs\": ${TARGET_LANGS}}" \
    "OpenAI Translator"

# Test 6: Multi Translator (default)
test_endpoint "/multi" "POST" \
    "{\"text\": \"${TEST_TEXT}\", \"tgt_langs\": ${TARGET_LANGS}}" \
    "Multi Translator (auto detection)"

# Test 7: Multi Translator with Google detection preference
test_endpoint "/multi" "POST" \
    "{\"text\": \"${TEST_TEXT}\", \"tgt_langs\": ${TARGET_LANGS}, \"detection_preference\": \"google\"}" \
    "Multi Translator (Google detection preference)"

# Test 8: Multi Translator with DeepL detection preference
test_endpoint "/multi" "POST" \
    "{\"text\": \"${TEST_TEXT}\", \"tgt_langs\": ${TARGET_LANGS}, \"detection_preference\": \"deepl\"}" \
    "Multi Translator (DeepL detection preference)"

# Test 9: Language detection test (French input)
test_endpoint "/multi" "POST" \
    "{\"text\": \"Bonjour le monde\", \"tgt_langs\": [\"eng\", \"spa\"], \"detection_preference\": \"google\"}" \
    "Language Detection Test (French -> English, Spanish)"

# Test 10: Error handling test
test_endpoint "/multi" "POST" \
    "{\"text\": \"${TEST_TEXT}\", \"tgt_langs\": [\"zzz\", \"xxx\"]}" \
    "Error Handling Test (invalid languages)"

# Summary
echo
echo -e "${BOLD}$(printf '=%.0s' {1..60})${NC}"
echo -e "${BOLD}📊 TEST SUMMARY${NC}"
echo -e "${BOLD}$(printf '=%.0s' {1..60})${NC}"

echo -e "${GREEN}✅ Passed: ${PASSED_TESTS}/${TOTAL_TESTS}${NC}"
echo -e "${RED}❌ Failed: ${FAILED_TESTS}/${TOTAL_TESTS}${NC}"

if [ $FAILED_TESTS -gt 0 ]; then
    echo
    echo -e "${YELLOW}🔧 CONFIGURATION NOTES:${NC}"
    echo -e "${YELLOW}   • DeepL: Set DEEPL_API_KEY environment variable${NC}"
    echo -e "${YELLOW}   • Google: Set GOOGLE_CLOUD_PROJECT_ID and GOOGLE_SERVICE_ACCOUNT_KEY${NC}"
    echo -e "${YELLOW}   • OpenAI: Set OPENAI_API_KEY environment variable${NC}"
    echo -e "${YELLOW}   • M2M: Check Cloudflare Workers AI binding${NC}"
fi

echo
echo -e "${BOLD}🎉 Integration test complete!${NC}"

# Exit with appropriate code
if [ $FAILED_TESTS -gt 0 ]; then
    exit 1
else
    exit 0
fi