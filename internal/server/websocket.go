package server

import (
	"encoding/binary"
	"errors"
	"io"
	"log/slog"
	"net"
)

// handleWebsocketEcho implements a minimal echo loop for WebSocket text/binary frames.
func handleWebsocketEcho(conn net.Conn, logger *slog.Logger) {
	defer conn.Close()
	for {
		opcode, payload, err := readFrame(conn)
		if err != nil {
			if !errors.Is(err, io.EOF) {
				logger.Error("read websocket frame", slog.String("error", err.Error()))
			}
			return
		}
		if opcode == 0x8 { // close frame
			_ = writeCloseFrame(conn, 1000)
			return
		}

		if err := writeFrame(conn, opcode, payload); err != nil {
			logger.Error("write websocket frame", slog.String("error", err.Error()))
			return
		}
	}
}

func readFrame(conn net.Conn) (byte, []byte, error) {
	header := make([]byte, 2)
	if _, err := io.ReadFull(conn, header); err != nil {
		return 0, nil, err
	}

	fin := header[0]&0x80 != 0
	opcode := header[0] & 0x0F
	masked := header[1]&0x80 != 0
	length := int64(header[1] & 0x7F)

	if !fin {
		return 0, nil, errors.New("fragmented frames not supported")
	}
	if opcode == 0x0 {
		return 0, nil, errors.New("continuation frames not supported")
	}
	if opcode == 0x8 || opcode == 0x1 || opcode == 0x2 {
		// allowed
	} else {
		return 0, nil, errors.New("unsupported opcode")
	}

	switch length {
	case 126:
		extended := make([]byte, 2)
		if _, err := io.ReadFull(conn, extended); err != nil {
			return 0, nil, err
		}
		length = int64(binary.BigEndian.Uint16(extended))
	case 127:
		extended := make([]byte, 8)
		if _, err := io.ReadFull(conn, extended); err != nil {
			return 0, nil, err
		}
		length = int64(binary.BigEndian.Uint64(extended))
	}

	var maskKey []byte
	if masked {
		maskKey = make([]byte, 4)
		if _, err := io.ReadFull(conn, maskKey); err != nil {
			return 0, nil, err
		}
	}

	payload := make([]byte, length)
	if _, err := io.ReadFull(conn, payload); err != nil {
		return 0, nil, err
	}

	if masked {
		for i := int64(0); i < length; i++ {
			payload[i] ^= maskKey[i%4]
		}
	}

	return opcode, payload, nil
}

func writeFrame(conn net.Conn, opcode byte, payload []byte) error {
	finBit := byte(0x80)
	header := []byte{finBit | opcode}

	length := len(payload)
	switch {
	case length < 126:
		header = append(header, byte(length))
	case length <= 0xFFFF:
		header = append(header, 126)
		ext := make([]byte, 2)
		binary.BigEndian.PutUint16(ext, uint16(length))
		header = append(header, ext...)
	default:
		header = append(header, 127)
		ext := make([]byte, 8)
		binary.BigEndian.PutUint64(ext, uint64(length))
		header = append(header, ext...)
	}

	if _, err := conn.Write(header); err != nil {
		return err
	}
	if _, err := conn.Write(payload); err != nil {
		return err
	}
	return nil
}

func writeCloseFrame(conn net.Conn, code int) error {
	payload := []byte{byte(code >> 8), byte(code)}
	return writeFrame(conn, 0x8, payload)
}
