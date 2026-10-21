// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 The KiCad Developers, see AUTHORS.txt for contributors.

package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

type Message struct {
	Role    string `json:"role"` // system | user | assistant
	Content string `json:"content"`
}

type Client struct {
	provider ProviderConfig
	apiKey   string
	http     *http.Client
	retries  int
}

const maxResponseBytes = 16 << 20

func NewClient(provider ProviderConfig) (*Client, error) {
	apiKey := ""

	if provider.APIKeyEnv != "" {
		apiKey = os.Getenv(provider.APIKeyEnv)
		if apiKey == "" {
			return nil, fmt.Errorf("environment variable %s is not set (required by this provider)",
				provider.APIKeyEnv)
		}
	}

	timeout := 120 * time.Second
	if provider.TimeoutSeconds > 0 {
		timeout = time.Duration(provider.TimeoutSeconds) * time.Second
	}

	retries := provider.Retries
	if retries < 0 {
		return nil, fmt.Errorf("retries must not be negative")
	}
	if retries == 0 {
		retries = 3
	}

	transport := &http.Client{
		Timeout: timeout,
		// Do not follow redirects: custom auth headers such as x-api-key would
		// otherwise be forwarded to a different host.
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}

	return &Client{
		provider: provider,
		apiKey:   apiKey,
		http:     transport,
		retries:  retries,
	}, nil
}

func (c *Client) Chat(ctx context.Context, messages []Message) (string, error) {
	switch strings.ToLower(c.provider.Type) {
	case "openai", "openai-compatible", "deepseek", "ollama", "qwen", "":
		return c.chatOpenAI(ctx, messages)
	case "anthropic":
		return c.chatAnthropic(ctx, messages)
	default:
		return "", fmt.Errorf("unsupported provider type %q (use openai or anthropic)",
			c.provider.Type)
	}
}

func (c *Client) chatOpenAI(ctx context.Context, messages []Message) (string, error) {
	body := map[string]any{
		"model":    c.provider.Model,
		"messages": messages,
	}

	if c.provider.Temperature != nil {
		body["temperature"] = *c.provider.Temperature
	}

	raw, err := c.post(ctx, "chat/completions", body,
		map[string]string{"Authorization": "Bearer " + c.apiKey})
	if err != nil {
		return "", err
	}

	var resp struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
			FinishReason string `json:"finish_reason"`
		} `json:"choices"`
		Error *struct {
			Message string `json:"message"`
			Type    string `json:"type"`
		} `json:"error"`
	}

	if err := json.Unmarshal(raw, &resp); err != nil {
		return "", fmt.Errorf("decode OpenAI response: %w", err)
	}
	if resp.Error != nil {
		return "", fmt.Errorf("provider error (%s): %s", resp.Error.Type, resp.Error.Message)
	}
	if len(resp.Choices) == 0 {
		return "", fmt.Errorf("provider returned no choices")
	}

	choice := resp.Choices[0]

	if choice.FinishReason == "length" || choice.FinishReason == "content_filter" {
		return "", fmt.Errorf("model output stopped (%s); partial content: %s",
			choice.FinishReason, truncateString(choice.Message.Content, 400))
	}

	content := strings.TrimSpace(choice.Message.Content)
	if content == "" {
		return "", fmt.Errorf("provider returned an empty response")
	}

	return content, nil
}

func (c *Client) chatAnthropic(ctx context.Context, messages []Message) (string, error) {
	version := c.provider.Version
	if version == "" {
		version = "2023-06-01"
	}

	var system string
	var chat []Message

	for _, m := range messages {
		if m.Role == "system" {
			if system != "" {
				system += "\n\n"
			}
			system += m.Content
			continue
		}
		if strings.TrimSpace(m.Content) == "" {
			continue
		}
		chat = append(chat, m)
	}

	maxTokens := c.provider.MaxTokens
	if maxTokens <= 0 {
		maxTokens = 8192
	}

	body := map[string]any{
		"model":      c.provider.Model,
		"max_tokens": maxTokens,
		"messages":   chat,
	}
	if system != "" {
		body["system"] = system
	}
	if c.provider.Temperature != nil {
		body["temperature"] = *c.provider.Temperature
	}

	raw, err := c.post(ctx, "v1/messages", body,
		map[string]string{
			"x-api-key":         c.apiKey,
			"anthropic-version": version,
		})
	if err != nil {
		return "", err
	}

	var resp struct {
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
		StopReason string `json:"stop_reason"`
		Error      *struct {
			Message string `json:"message"`
			Type    string `json:"type"`
		} `json:"error"`
	}

	if err := json.Unmarshal(raw, &resp); err != nil {
		return "", fmt.Errorf("decode Anthropic response: %w", err)
	}
	if resp.Error != nil {
		return "", fmt.Errorf("provider error (%s): %s", resp.Error.Type, resp.Error.Message)
	}

	var out strings.Builder
	for _, block := range resp.Content {
		if block.Type == "text" {
			out.WriteString(block.Text)
		}
	}

	content := strings.TrimSpace(out.String())
	if content == "" {
		return "", fmt.Errorf("provider returned an empty response (stop_reason=%s)",
			resp.StopReason)
	}
	if resp.StopReason == "max_tokens" {
		return "", fmt.Errorf("model output reached max_tokens; partial content: %s",
			truncateString(content, 400))
	}

	return content, nil
}

func (c *Client) post(ctx context.Context, suffix string, body any,
	headers map[string]string) ([]byte, error) {
	payload, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}

	endpoint, err := joinURL(c.provider.BaseURL, suffix)
	if err != nil {
		return nil, err
	}

	var lastErr error

	for attempt := 0; attempt <= c.retries; attempt++ {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}

		req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint,
			bytes.NewReader(payload))
		if err != nil {
			return nil, err
		}

		req.Header.Set("Content-Type", "application/json")
		for k, v := range headers {
			req.Header.Set(k, v)
		}

		resp, err := c.http.Do(req)

		if err != nil {
			if ctx.Err() != nil {
				return nil, ctx.Err()
			}
			lastErr = fmt.Errorf("request failed: %w", err)

			if attempt < c.retries && sleepBackoff(ctx, attempt, 0) {
				continue
			}
			return nil, lastErr
		}

		data, readErr := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes+1))
		resp.Body.Close()

		if readErr != nil {
			return nil, fmt.Errorf("read provider response: %w", readErr)
		}
		if len(data) > maxResponseBytes {
			return nil, fmt.Errorf("provider response exceeds %d bytes", maxResponseBytes)
		}

		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			return data, nil
		}

		retryable := resp.StatusCode == 408 || resp.StatusCode == 429 ||
			resp.StatusCode == 500 || resp.StatusCode == 502 ||
			resp.StatusCode == 503 || resp.StatusCode == 504

		if retryable && attempt < c.retries {
			delay := parseRetryAfter(resp.Header.Get("Retry-After"))
			if sleepBackoff(ctx, attempt, delay) {
				continue
			}
			return nil, ctx.Err()
		}

		return nil, providerError(resp.StatusCode, data)
	}

	return nil, lastErr
}

func joinURL(base, suffix string) (string, error) {
	u, err := url.Parse(base)
	if err != nil || u.Host == "" {
		return "", fmt.Errorf("invalid provider base URL")
	}

	if u.RawQuery != "" || u.Fragment != "" {
		return "", fmt.Errorf("provider base URL must not contain a query or fragment")
	}

	path := strings.TrimRight(u.Path, "/")
	s := strings.TrimLeft(suffix, "/")

	if strings.HasSuffix(path, "/v1") && strings.HasPrefix(s, "v1/") {
		s = strings.TrimPrefix(s, "v1/")
	}

	if strings.HasSuffix(path, "/"+s) {
		u.Path = path
	} else {
		u.Path = path + "/" + s
	}

	return u.String(), nil
}

func parseRetryAfter(value string) time.Duration {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0
	}

	if seconds, err := strconv.Atoi(value); err == nil && seconds > 0 {
		if seconds > 60 {
			seconds = 60
		}
		return time.Duration(seconds) * time.Second
	}

	if when, err := http.ParseTime(value); err == nil {
		delay := time.Until(when)
		if delay > 0 && delay < 60*time.Second {
			return delay
		}
	}

	return 0
}

func sleepBackoff(ctx context.Context, attempt int, retryAfter time.Duration) bool {
	delay := retryAfter

	if delay <= 0 {
		base := 500 * time.Millisecond * time.Duration(1<<uint(attempt))
		jitter := time.Duration(rand.Int63n(int64(250 * time.Millisecond)))
		delay = base + jitter
	}

	if delay > 60*time.Second {
		delay = 60 * time.Second
	}

	timer := time.NewTimer(delay)
	defer timer.Stop()

	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}

func providerError(status int, body []byte) error {
	var envelope struct {
		Error struct {
			Message string `json:"message"`
			Type    string `json:"type"`
		} `json:"error"`
	}

	if json.Unmarshal(body, &envelope) == nil && envelope.Error.Message != "" {
		kind := envelope.Error.Type
		if kind == "" {
			kind = "provider_error"
		}
		return fmt.Errorf("provider HTTP %d (%s): %s", status, kind,
			truncateString(envelope.Error.Message, 800))
	}

	return fmt.Errorf("provider HTTP %d", status)
}

func truncateString(value string, max int) string {
	if len(value) <= max {
		return value
	}

	cut := max
	for cut > 0 && (value[cut]&0xC0) == 0x80 {
		cut--
	}

	return value[:cut] + "..."
}
