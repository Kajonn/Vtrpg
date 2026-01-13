#!/bin/bash
# Test script to verify CSP headers for different request types

echo "=== Testing CSP Headers ==="
echo ""

echo "1. SPA root (browser navigation with text/html Accept):"
curl -s -I -H "Accept: text/html,application/xhtml+xml" http://localhost:8080/ | grep -i "content-security-policy" || echo "  ✓ No CSP header (as expected)"
echo ""

echo "2. Room page (browser navigation with text/html Accept):"
curl -s -I -H "Accept: text/html,application/xhtml+xml" http://localhost:8080/rooms/test-room | grep -i "content-security-policy" || echo "  ✓ No CSP header (as expected)"
echo ""

echo "3. API endpoint /rooms (JSON Accept header):"
curl -s -I -H "Accept: application/json" http://localhost:8080/rooms | grep -i "content-security-policy"
echo ""

echo "4. WebSocket endpoint:"
curl -s -I http://localhost:8080/ws/rooms/test | grep -i "content-security-policy"
echo ""

echo "5. Static asset (CSS):"
curl -s -I http://localhost:8080/assets/index-D17H8GTI.css | grep -i "content-security-policy" || echo "  ✓ No CSP header (as expected)"
echo ""
