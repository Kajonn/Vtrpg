package server

import (
	"context"
	"net/http"
	"strings"
)

type contextKey string

const userContextKey contextKey = "user"

func (a *App) requireAuth(minRole Role, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := parseToken(r.Header.Get("Authorization"))
		if token == "" {
			writeError(w, http.StatusUnauthorized, "missing token")
			return
		}

		a.mu.RLock()
		user, ok := a.tokens[token]
		a.mu.RUnlock()
		if !ok {
			writeError(w, http.StatusUnauthorized, "invalid token")
			return
		}

		if minRole == RoleGM && user.Role != RoleGM {
			writeError(w, http.StatusForbidden, "insufficient role")
			return
		}

		ctx := context.WithValue(r.Context(), userContextKey, user)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func parseToken(header string) string {
	if header == "" {
		return ""
	}
	parts := strings.SplitN(header, " ", 2)
	if len(parts) == 2 && strings.EqualFold(parts[0], "bearer") {
		return parts[1]
	}
	return header
}

func userFromContext(ctx context.Context) User {
	if v := ctx.Value(userContextKey); v != nil {
		if u, ok := v.(User); ok {
			return u
		}
	}
	return User{}
}
