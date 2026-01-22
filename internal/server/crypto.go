package server

import (
	"crypto"
	"crypto/rsa"
	"crypto/sha256"
	"hash"
)

// newSHA256 creates a new SHA256 hasher.
func newSHA256() hash.Hash {
	return sha256.New()
}

// rsaVerifyPKCS1v15Crypto verifies an RSA PKCS#1 v1.5 signature using crypto/rsa.
func rsaVerifyPKCS1v15Crypto(pubKey *rsa.PublicKey, hash, sig []byte) error {
	return rsa.VerifyPKCS1v15(pubKey, crypto.SHA256, hash, sig)
}
