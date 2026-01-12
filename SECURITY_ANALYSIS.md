# Security Analysis and Improvements

This document details the security analysis performed on the Vtrpg server code and the improvements implemented.

## Executive Summary

A comprehensive security analysis was performed on the Go backend server. The analysis identified multiple security vulnerabilities, input validation issues, and potential DoS vectors. All critical and high-severity issues have been addressed with appropriate fixes and tests.

## Critical Issues Fixed

### 1. URL Scheme Validation (CVE-level: High)
**Issue**: External image URLs were not validated, allowing potential XSS attacks via `javascript:`, `data:`, or `file:` URLs.

**Impact**: Could allow attackers to inject malicious code or access local files.

**Fix**: Added `isValidImageURL()` function that only allows `http://` and `https://` schemes.

**Test**: `TestImageURLValidation` validates all scheme restrictions.

### 2. MIME Type Validation (CVE-level: High)
**Issue**: File uploads accepted any file type without validation, allowing upload of executables, HTML, or other dangerous content.

**Impact**: Could lead to stored XSS, malware distribution, or server compromise.

**Fix**: Added MIME type detection and validation to only allow safe image formats (JPEG, PNG, GIF, WebP, BMP, TIFF). SVG is explicitly excluded due to XSS risks from embedded JavaScript.

**Note**: The non-standard 'image/jpg' MIME type is rejected; only 'image/jpeg' is accepted.

**Test**: `TestIsAllowedImageType` validates MIME type restrictions.

### 3. WebSocket DoS Protection (CVE-level: Medium)
**Issue**: No frame size limit on WebSocket messages could allow memory exhaustion attacks.

**Impact**: Could crash the server or cause out-of-memory errors.

**Fix**: Added 1MB frame size limit in `readFrame()` function.

**Code**: See `internal/server/websocket.go:74-78`

### 4. Input Validation - Coordinates (CVE-level: Medium)
**Issue**: Image position coordinates accepted NaN and Infinity values, causing database corruption and potential crashes.

**Impact**: Could corrupt database state and cause application errors.

**Fix**: Added `isValidPosition()` validation to reject non-finite numbers.

**Test**: `TestImagePositionValidation` validates coordinate restrictions.

### 5. Input Validation - Dice Logs (CVE-level: Low)
**Issue**: No limits on dice log array sizes could allow memory exhaustion.

**Impact**: Could cause memory exhaustion with large payloads.

**Fix**: Added maximum limits (1000) for count and results array size.

**Test**: `TestDiceLogValidation` validates size restrictions.

### 6. Room Name Length Validation (CVE-level: Low)
**Issue**: No length limit on room names could allow memory/storage exhaustion.

**Impact**: Could fill up storage with excessively long room names.

**Fix**: Added 100 character limit for room names.

**Test**: `TestRoomNameValidation` validates length restrictions.

## Security Headers Implemented

Added the following security headers to all responses:

1. **X-Content-Type-Options: nosniff**
   - Prevents MIME type sniffing attacks

2. **X-Frame-Options: DENY**
   - Prevents clickjacking attacks

3. **X-XSS-Protection: 1; mode=block**
   - Enables browser XSS filters

4. **Referrer-Policy: strict-origin-when-cross-origin**
   - Controls referrer information leakage

5. **Content-Security-Policy: default-src 'none'; frame-ancestors 'none'**
   - Applied to API endpoints to prevent content injection

## Authentication Improvements

### Bearer Token Parsing
**Issue**: Token parsing stripped "Bearer" but not "Bearer " (with space), potentially causing authentication bypass.

**Fix**: Corrected to `strings.TrimPrefix(header, "Bearer ")` with space.

**Location**: `internal/server/server.go:117`

## Resource Management Improvements

### 1. File Upload Cleanup
**Issue**: Uploaded files were not cleaned up on error, leading to disk space leaks.

**Fix**: Added defer cleanup pattern to remove uploaded files if database insert fails. Also added check to ensure file supports seeking before MIME type detection to prevent corruption.

**Location**: `internal/server/server.go:640-648, 658-663`

### 2. Transaction Rollback
**Issue**: Manual rollback calls could be missed on error paths.

**Fix**: Changed to defer pattern for automatic rollback on panic or error.

**Location**: `internal/server/server.go:1335-1340`

## WebSocket Security

### Opcode Validation
**Issue**: Incomplete opcode validation allowed unsupported frame types through.

**Fix**: Explicitly allow only close (0x8), text (0x1), binary (0x2), ping (0x9), and pong (0xA) opcodes.

**Location**: `internal/server/websocket.go:51-54`

## Testing Coverage

Added comprehensive security tests:

- **TestImageURLValidation**: Tests URL scheme restrictions
- **TestImagePositionValidation**: Tests coordinate validation
- **TestDiceLogValidation**: Tests size limits
- **TestRoomNameValidation**: Tests length limits
- **TestIsValidImageURL**: Unit tests for URL validation helper
- **TestIsValidPosition**: Unit tests for position validation helper
- **TestIsAllowedImageType**: Unit tests for MIME type validation

All tests pass, including race detection (`go test -race`).

## Remaining Recommendations

The following improvements are recommended but not yet implemented:

### 1. Rate Limiting
Add rate limiting for:
- Room creation (prevent spam)
- Player joins (prevent abuse)
- File uploads (prevent DoS)

### 2. Admin Token Timing Attack Protection
Current string comparison is vulnerable to timing attacks. Use `crypto/subtle.ConstantTimeCompare()`.

### 3. Database Timeouts
Add context timeouts to all database operations to prevent resource exhaustion.

### 4. Connection Leak Prevention
Add timeout and cleanup for WebSocket connections that fail during handshake.

### 5. Mutex Protection
The `gmRooms` map is accessed without mutex protection in some paths. Review and add locks.

### 6. Broadcast Error Handling
Errors in broadcast loops are logged but don't affect other peers. Consider retry logic or connection removal.

## Security Testing Checklist

- [x] Input validation tests
- [x] URL scheme validation
- [x] MIME type validation
- [x] Position coordinate validation
- [x] Dice log size validation
- [x] Room name length validation
- [x] Race condition detection
- [x] Transaction rollback
- [x] File cleanup on error
- [ ] Rate limiting tests
- [ ] Timing attack tests
- [ ] Load testing for DoS vectors
- [ ] Penetration testing

## Compliance Notes

These security improvements help meet common security standards:

- **OWASP Top 10 2021**:
  - A03:2021 – Injection (SQL injection prevention via parameterized queries)
  - A01:2021 – Broken Access Control (improved auth token handling)
  - A05:2021 – Security Misconfiguration (security headers)

- **CWE Coverage**:
  - CWE-79: XSS (URL validation, CSP headers)
  - CWE-434: Unrestricted File Upload (MIME type validation)
  - CWE-400: Uncontrolled Resource Consumption (size limits)
  - CWE-352: CSRF (SameSite cookie policy can be added)

## Contact

For security concerns or to report vulnerabilities, please contact the repository maintainers.

## References

- OWASP Top 10: https://owasp.org/Top10/
- CWE List: https://cwe.mitre.org/
- Go Security Best Practices: https://go.dev/doc/security/best-practices
