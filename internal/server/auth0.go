package server

import (
	"context"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math/big"
	"net/http"
	"strings"
	"sync"
	"time"
)

// Auth0Config holds Auth0 JWT validation configuration.
type Auth0Config struct {
	Domain   string
	Audience string
}

// auth0Middleware validates Auth0 access tokens and enforces the GM role.
type auth0Middleware struct {
	config     Auth0Config
	logger     *slog.Logger
	jwks       *jwksCache
	httpClient *http.Client
}

// jwksCache caches Auth0 JWKS keys with expiration.
type jwksCache struct {
	mu        sync.RWMutex
	keys      map[string]*rsa.PublicKey
	expiresAt time.Time
	domain    string
}

// JWK represents a JSON Web Key.
type JWK struct {
	Kty string `json:"kty"`
	Kid string `json:"kid"`
	Use string `json:"use"`
	N   string `json:"n"`
	E   string `json:"e"`
	Alg string `json:"alg"`
}

// JWKS represents a JSON Web Key Set.
type JWKS struct {
	Keys []JWK `json:"keys"`
}

// GMClaims represents the validated GM user claims from Auth0 token.
type GMClaims struct {
	Subject     string // Auth0 sub claim
	Email       string // email claim
	Name        string // name claim
	Role        string // custom role claim
	IssuedAt    int64
	ExpiresAt   int64
	Issuer      string
	Audience    []string
	Permissions []string // permissions if using RBAC
}

// jwtHeader represents the header part of a JWT.
type jwtHeader struct {
	Alg string `json:"alg"`
	Typ string `json:"typ"`
	Kid string `json:"kid"`
}

// jwtPayload represents the payload part of a JWT.
type jwtPayload struct {
	Iss         string      `json:"iss"`
	Sub         string      `json:"sub"`
	Aud         interface{} `json:"aud"` // Can be string or []string
	Iat         int64       `json:"iat"`
	Exp         int64       `json:"exp"`
	Azp         string      `json:"azp"`
	Scope       string      `json:"scope"`
	Email       string      `json:"email"`
	Name        string      `json:"name"`
	Permissions []string    `json:"permissions"`
	// Custom role claim
	Role string `json:"https://vtrpg.app/role"`
}

// newAuth0Middleware creates a new Auth0 middleware instance.
func newAuth0Middleware(cfg Auth0Config, logger *slog.Logger) *auth0Middleware {
	return &auth0Middleware{
		config: cfg,
		logger: logger,
		jwks: &jwksCache{
			keys:   make(map[string]*rsa.PublicKey),
			domain: cfg.Domain,
		},
		httpClient: &http.Client{Timeout: 10 * time.Second},
	}
}

// validateToken validates an Auth0 access token and returns the claims.
func (m *auth0Middleware) validateToken(ctx context.Context, token string) (*GMClaims, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil, errors.New("invalid token format")
	}

	// Decode header
	headerBytes, err := base64URLDecode(parts[0])
	if err != nil {
		return nil, fmt.Errorf("decode header: %w", err)
	}

	var header jwtHeader
	if err := json.Unmarshal(headerBytes, &header); err != nil {
		return nil, fmt.Errorf("parse header: %w", err)
	}

	if header.Alg != "RS256" {
		return nil, fmt.Errorf("unsupported algorithm: %s", header.Alg)
	}

	// Decode payload
	payloadBytes, err := base64URLDecode(parts[1])
	if err != nil {
		return nil, fmt.Errorf("decode payload: %w", err)
	}

	var payload jwtPayload
	if err := json.Unmarshal(payloadBytes, &payload); err != nil {
		return nil, fmt.Errorf("parse payload: %w", err)
	}

	// Validate issuer
	expectedIssuer := fmt.Sprintf("https://%s/", m.config.Domain)
	if payload.Iss != expectedIssuer {
		return nil, fmt.Errorf("invalid issuer: got %s, expected %s", payload.Iss, expectedIssuer)
	}

	// Validate audience
	aud := parseAudience(payload.Aud)
	if !containsString(aud, m.config.Audience) {
		return nil, fmt.Errorf("invalid audience: %v does not contain %s", aud, m.config.Audience)
	}

	// Validate expiration
	now := time.Now().Unix()
	if payload.Exp < now {
		return nil, errors.New("token expired")
	}

	// Validate issued at (with 60s clock skew tolerance)
	if payload.Iat > now+60 {
		return nil, errors.New("token issued in the future")
	}

	// Get public key and verify signature
	pubKey, err := m.getPublicKey(ctx, header.Kid)
	if err != nil {
		return nil, fmt.Errorf("get public key: %w", err)
	}

	// Verify signature
	if err := verifyRS256Signature(parts[0]+"."+parts[1], parts[2], pubKey); err != nil {
		return nil, fmt.Errorf("invalid signature: %w", err)
	}

	claims := &GMClaims{
		Subject:     payload.Sub,
		Email:       payload.Email,
		Name:        payload.Name,
		Role:        payload.Role,
		IssuedAt:    payload.Iat,
		ExpiresAt:   payload.Exp,
		Issuer:      payload.Iss,
		Audience:    aud,
		Permissions: payload.Permissions,
	}

	return claims, nil
}

// getPublicKey retrieves the public key for the given key ID.
func (m *auth0Middleware) getPublicKey(ctx context.Context, kid string) (*rsa.PublicKey, error) {
	// Check cache first
	m.jwks.mu.RLock()
	if time.Now().Before(m.jwks.expiresAt) {
		if key, ok := m.jwks.keys[kid]; ok {
			m.jwks.mu.RUnlock()
			return key, nil
		}
	}
	m.jwks.mu.RUnlock()

	// Fetch JWKS
	if err := m.refreshJWKS(ctx); err != nil {
		return nil, err
	}

	// Check cache again after refresh
	m.jwks.mu.RLock()
	key, ok := m.jwks.keys[kid]
	m.jwks.mu.RUnlock()

	if !ok {
		return nil, fmt.Errorf("key not found: %s", kid)
	}

	return key, nil
}

// refreshJWKS fetches the JWKS from Auth0.
func (m *auth0Middleware) refreshJWKS(ctx context.Context) error {
	m.jwks.mu.Lock()
	defer m.jwks.mu.Unlock()

	// Double-check after acquiring write lock
	if time.Now().Before(m.jwks.expiresAt) {
		return nil
	}

	url := fmt.Sprintf("https://%s/.well-known/jwks.json", m.config.Domain)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}

	resp, err := m.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("fetch jwks: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("jwks request failed: %d: %s", resp.StatusCode, string(body))
	}

	var jwks JWKS
	if err := json.NewDecoder(resp.Body).Decode(&jwks); err != nil {
		return fmt.Errorf("decode jwks: %w", err)
	}

	newKeys := make(map[string]*rsa.PublicKey)
	for _, key := range jwks.Keys {
		if key.Kty != "RSA" || key.Use != "sig" {
			continue
		}

		pubKey, err := parseRSAPublicKey(key)
		if err != nil {
			m.logger.Warn("failed to parse JWKS key", slog.String("kid", key.Kid), slog.String("error", err.Error()))
			continue
		}

		newKeys[key.Kid] = pubKey
	}

	if len(newKeys) == 0 {
		return fmt.Errorf("jwks contained no valid keys")
	}

	m.jwks.keys = newKeys
	m.jwks.expiresAt = time.Now().Add(24 * time.Hour) // Cache for 24 hours

	return nil
}

// parseRSAPublicKey parses a JWK into an RSA public key.
func parseRSAPublicKey(jwk JWK) (*rsa.PublicKey, error) {
	nBytes, err := base64URLDecode(jwk.N)
	if err != nil {
		return nil, fmt.Errorf("decode n: %w", err)
	}

	eBytes, err := base64URLDecode(jwk.E)
	if err != nil {
		return nil, fmt.Errorf("decode e: %w", err)
	}

	n := new(big.Int).SetBytes(nBytes)
	e := 0
	for _, b := range eBytes {
		e = e*256 + int(b)
	}

	return &rsa.PublicKey{N: n, E: e}, nil
}

// base64URLDecode decodes a base64url-encoded string.
func base64URLDecode(s string) ([]byte, error) {
	// Add padding if needed
	switch len(s) % 4 {
	case 2:
		s += "=="
	case 3:
		s += "="
	}
	return base64.URLEncoding.DecodeString(s)
}

// parseAudience normalizes the audience claim to a slice.
func parseAudience(aud interface{}) []string {
	switch v := aud.(type) {
	case string:
		return []string{v}
	case []interface{}:
		result := make([]string, 0, len(v))
		for _, item := range v {
			if s, ok := item.(string); ok {
				result = append(result, s)
			}
		}
		return result
	default:
		return nil
	}
}

// containsString checks if a slice contains a string.
func containsString(slice []string, s string) bool {
	for _, item := range slice {
		if item == s {
			return true
		}
	}
	return false
}

// verifyRS256Signature verifies an RS256 JWT signature.
func verifyRS256Signature(signingInput, signature string, pubKey *rsa.PublicKey) error {
	sigBytes, err := base64URLDecode(signature)
	if err != nil {
		return fmt.Errorf("decode signature: %w", err)
	}

	// Use crypto/rsa and crypto/sha256 for verification
	hash := sha256Hash([]byte(signingInput))
	return rsaVerifyPKCS1v15(pubKey, hash, sigBytes)
}

// sha256Hash computes SHA256 hash of data.
func sha256Hash(data []byte) []byte {
	h := newSHA256()
	h.Write(data)
	return h.Sum(nil)
}

// rsaVerifyPKCS1v15 verifies an RSA PKCS#1 v1.5 signature.
func rsaVerifyPKCS1v15(pubKey *rsa.PublicKey, hash, sig []byte) error {
	return rsaVerifyPKCS1v15Crypto(pubKey, hash, sig)
}
