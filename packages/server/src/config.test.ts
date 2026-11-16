import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config.js';

const valid = { IMMICH_URL: 'http://immich:2283/', IMMICH_API_KEY: 'key' };

describe('loadConfig', () => {
  it('必須だけ指定すれば既定値で読み込める', () => {
    expect(loadConfig(valid)).toEqual({
      immichUrl: 'http://immich:2283',
      immichApiKey: 'key',
      port: 3000,
      printerScanSubnet: undefined,
    });
  });

  it('任意項目を読み込める', () => {
    const c = loadConfig({ ...valid, PORT: '8080', PRINTER_SCAN_SUBNET: '192.168.1.0/24' });
    expect(c.port).toBe(8080);
    expect(c.printerScanSubnet).toBe('192.168.1.0/24');
  });

  it('未設定の必須項目をすべて列挙して失敗する', () => {
    try {
      loadConfig({});
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      const msg = (e as ConfigError).message;
      expect(msg).toContain('IMMICH_URL');
      expect(msg).toContain('IMMICH_API_KEY');
    }
  });

  it('空文字は未設定として扱う', () => {
    expect(() => loadConfig({ ...valid, IMMICH_API_KEY: '' })).toThrow(/IMMICH_API_KEY/);
    expect(loadConfig({ ...valid, PORT: '' }).port).toBe(3000);
  });

  it('不正な値を弾く', () => {
    expect(() => loadConfig({ ...valid, IMMICH_URL: 'immich' })).toThrow(/IMMICH_URL/);
    expect(() => loadConfig({ ...valid, PORT: '99999' })).toThrow(/PORT/);
    expect(() => loadConfig({ ...valid, PRINTER_SCAN_SUBNET: 'abc' })).toThrow(
      /PRINTER_SCAN_SUBNET/,
    );
  });
});
