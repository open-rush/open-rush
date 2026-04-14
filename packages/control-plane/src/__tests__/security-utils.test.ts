import { afterEach, describe, expect, it } from 'vitest';
import { clearUserEnvVars, registerUserEnvVars } from '../vault/sanitizers.js';
import {
  detectDangerousCommand,
  filterProcessQueryOutput,
  isSecretDiscoveryCommand,
} from '../vault/security-utils.js';

afterEach(() => {
  clearUserEnvVars();
});

// ---------------------------------------------------------------------------
// detectDangerousCommand
// ---------------------------------------------------------------------------

describe('detectDangerousCommand', () => {
  describe('port operations', () => {
    it('blocks kill on protected port 3000', () => {
      const r = detectDangerousCommand('kill $(lsof -ti:3000)');
      expect(r.isDangerous).toBe(true);
    });

    it('blocks fuser on protected port', () => {
      const r = detectDangerousCommand('fuser -k 3000/tcp');
      expect(r.isDangerous).toBe(true);
    });

    it('blocks custom protected port', () => {
      const r = detectDangerousCommand('kill $(lsof -ti:4000)', { protectedPorts: [4000] });
      expect(r.isDangerous).toBe(true);
    });

    it('allows operations on non-protected ports', () => {
      const r = detectDangerousCommand('kill $(lsof -ti:8000)');
      expect(r.isDangerous).toBe(false);
    });
  });

  describe('node process kill', () => {
    it('blocks pkill node', () => {
      expect(detectDangerousCommand('pkill node').isDangerous).toBe(true);
    });

    it('blocks killall node', () => {
      expect(detectDangerousCommand('killall node').isDangerous).toBe(true);
    });
  });

  describe('PM2 operations', () => {
    it('blocks pm2 stop', () => {
      expect(detectDangerousCommand('pm2 stop all').isDangerous).toBe(true);
    });

    it('blocks pm2 delete', () => {
      expect(detectDangerousCommand('pm2 delete web').isDangerous).toBe(true);
    });

    it('blocks pm2 kill', () => {
      expect(detectDangerousCommand('pm2 kill').isDangerous).toBe(true);
    });

    it('allows pm2 list', () => {
      expect(detectDangerousCommand('pm2 list').isDangerous).toBe(false);
    });
  });

  describe('system shutdown', () => {
    it('blocks shutdown', () => {
      expect(detectDangerousCommand('shutdown -h now').isDangerous).toBe(true);
    });

    it('blocks reboot', () => {
      expect(detectDangerousCommand('reboot').isDangerous).toBe(true);
    });

    it('blocks poweroff', () => {
      expect(detectDangerousCommand('poweroff').isDangerous).toBe(true);
    });
  });

  describe('Next.js dev server', () => {
    it('blocks killing next dev without user port', () => {
      expect(detectDangerousCommand('pkill -f next dev').isDangerous).toBe(true);
    });

    it('allows killing next dev with user port', () => {
      expect(detectDangerousCommand('pkill -f "next dev --port 8000"').isDangerous).toBe(false);
    });
  });

  describe('process query PID leak', () => {
    it('blocks ps aux | grep node', () => {
      expect(detectDangerousCommand('ps aux | grep node').isDangerous).toBe(true);
    });

    it('blocks ps aux | grep next', () => {
      expect(detectDangerousCommand('ps aux | grep next').isDangerous).toBe(true);
    });

    it('allows ps aux | grep vite', () => {
      expect(detectDangerousCommand('ps aux | grep vite').isDangerous).toBe(false);
    });
  });

  describe('PID-based kill', () => {
    it('blocks kill with service PID', () => {
      const r = detectDangerousCommand('kill 12345', { servicePIDs: [12345] });
      expect(r.isDangerous).toBe(true);
    });

    it('allows kill with non-service PID', () => {
      const r = detectDangerousCommand('kill 99999', { servicePIDs: [12345] });
      expect(r.isDangerous).toBe(false);
    });

    it('allows kill when no servicePIDs provided', () => {
      expect(detectDangerousCommand('kill 12345').isDangerous).toBe(false);
    });
  });

  describe('safe commands', () => {
    it('allows npm run commands', () => {
      expect(detectDangerousCommand('npm run dev').isDangerous).toBe(false);
    });

    it('allows git commands', () => {
      expect(detectDangerousCommand('git status').isDangerous).toBe(false);
    });

    it('allows ls commands', () => {
      expect(detectDangerousCommand('ls -la').isDangerous).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// isSecretDiscoveryCommand
// ---------------------------------------------------------------------------

describe('isSecretDiscoveryCommand', () => {
  describe('blocks high-confidence secret discovery', () => {
    it('blocks printenv', () => {
      expect(isSecretDiscoveryCommand('printenv')).toBe(true);
    });

    it('blocks printenv with pipe', () => {
      expect(isSecretDiscoveryCommand('printenv | grep KEY')).toBe(true);
    });

    it('blocks standalone env', () => {
      expect(isSecretDiscoveryCommand('env')).toBe(true);
    });

    it('blocks set command', () => {
      expect(isSecretDiscoveryCommand('set')).toBe(true);
    });

    it('blocks set with pipe', () => {
      expect(isSecretDiscoveryCommand('set | grep')).toBe(true);
    });

    it('blocks cat .env', () => {
      expect(isSecretDiscoveryCommand('cat .env')).toBe(true);
    });

    it('blocks cat .env.local', () => {
      expect(isSecretDiscoveryCommand('cat .env.local')).toBe(true);
    });

    it('blocks echo with sensitive env var expansion', () => {
      expect(isSecretDiscoveryCommand('echo $AWS_SECRET_ACCESS_KEY')).toBe(true);
    });
  });

  describe('allows safe commands', () => {
    it('allows env VAR=val command', () => {
      expect(isSecretDiscoveryCommand('env NODE_ENV=test npm run test')).toBe(false);
    });

    it('allows cat .env.example', () => {
      expect(isSecretDiscoveryCommand('cat .env.example')).toBe(false);
    });

    it('allows cat .env.template', () => {
      expect(isSecretDiscoveryCommand('cat .env.template')).toBe(false);
    });

    it('allows cat .env.sample', () => {
      expect(isSecretDiscoveryCommand('cat .env.sample')).toBe(false);
    });

    it('allows grep in code', () => {
      expect(isSecretDiscoveryCommand('grep tokenize src/')).toBe(false);
    });

    it('allows npm install', () => {
      expect(isSecretDiscoveryCommand('npm install lodash')).toBe(false);
    });

    it('allows echo of non-sensitive vars', () => {
      expect(isSecretDiscoveryCommand('echo $NODE_ENV')).toBe(false);
    });
  });

  describe('user env var whitelist', () => {
    it('allows echo of whitelisted sensitive var', () => {
      registerUserEnvVars(['MY_SECRET_TOKEN']);
      expect(isSecretDiscoveryCommand('echo $MY_SECRET_TOKEN')).toBe(false);
    });

    it('still blocks non-whitelisted sensitive vars', () => {
      registerUserEnvVars(['MY_SECRET_TOKEN']);
      expect(isSecretDiscoveryCommand('echo $AWS_SECRET_ACCESS_KEY')).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// filterProcessQueryOutput
// ---------------------------------------------------------------------------

describe('filterProcessQueryOutput', () => {
  it('filters lines containing protected port from ps output', () => {
    const output = ['PID  CMD', 'node server.js --port 3000', 'node app.js --port 8000'].join('\n');
    const r = filterProcessQueryOutput(output, 'ps aux');
    expect(r.hasFiltered).toBe(true);
    expect(r.filtered).not.toContain('3000');
    expect(r.filtered).toContain('8000');
  });

  it('preserves lines with both protected and user ports', () => {
    const output = 'node --port 3000 --port 8001';
    const r = filterProcessQueryOutput(output, 'lsof -i');
    expect(r.hasFiltered).toBe(false);
    expect(r.filtered).toContain('3000');
  });

  it('does not filter non-process-query commands', () => {
    const output = ':3000 something';
    const r = filterProcessQueryOutput(output, 'cat file.txt');
    expect(r.hasFiltered).toBe(false);
    expect(r.filtered).toBe(output);
  });

  it('supports custom protected ports', () => {
    const output = 'service :4000\napp :8000';
    const r = filterProcessQueryOutput(output, 'netstat', { protectedPorts: [4000] });
    expect(r.hasFiltered).toBe(true);
    expect(r.filtered).not.toContain('4000');
  });

  it('returns empty input unchanged', () => {
    const r = filterProcessQueryOutput('', 'ps aux');
    expect(r.hasFiltered).toBe(false);
  });
});
