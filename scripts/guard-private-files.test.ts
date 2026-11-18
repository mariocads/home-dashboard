import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
// @ts-expect-error – reines JS-Skript ohne Typdeklaration
import { checkContent, checkPath } from './guard-private-files.mjs';

describe('guard-private-files', () => {
  it.each([
    'prep/Ausgangslage.MD',
    'prep/sub/deep/file.txt',
    'apps/web/prep/x.ts',
    'PREP/secret.txt',
    'deploy/home-dashboard/.env',
    '.env.production',
    'data/Managerdaten_foo.csv',
  ])('blockiert %s', (path) => {
    expect(checkPath(path)).not.toBeNull();
  });

  it.each(['README.md', '.env.example', 'packages/prepare/x.ts', 'apps/web/src/prep.ts', 'preparation/x'])(
    'erlaubt %s',
    (path) => {
      expect(checkPath(path)).toBeNull();
    },
  );

  it('blockiert jeden Pfad, der irgendwo einen prep-Ordner enthält', () => {
    const segment = fc.stringMatching(/^[a-z0-9_-]{1,10}$/);
    fc.assert(
      fc.property(
        fc.array(segment, { maxLength: 4 }),
        fc.array(segment, { maxLength: 4 }),
        segment,
        (pre, post, file) => {
          expect(checkPath([...pre, 'prep', ...post, file].join('/'))).not.toBeNull();
        },
      ),
    );
  });

  it('erkennt eine synthetische Zählpunktnummer im Inhalt', () => {
    const synthetic = `AT${'1'.repeat(6)}${'0'.repeat(25)}`;
    expect(checkContent(`foo ${synthetic} bar`)).not.toBeNull();
    expect(checkContent('AT12345 kurz')).toBeNull();
  });

  it('erkennt eine Zählernummer in einer AMIS-Antwort, erlaubt aber Nullen in Fixtures', () => {
    // zur Laufzeit zusammengesetzt, damit diese Datei selbst den Guard besteht
    const fake = ['1234', 'A5678', '9B'].join('');
    expect(checkContent(`{"1.7.0":100,"serialnumber":"${fake}"}`)).not.toBeNull();
    expect(checkContent('{"1.7.0":100,"serialnumber": "0000000000000000"}')).toBeNull();
  });
});
