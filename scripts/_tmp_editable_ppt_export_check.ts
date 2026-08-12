import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { importEditablePptFiles } from '../src/lib/editable-ppt/import';
import { exportEditablePptDeck } from '../src/lib/editable-ppt/export';
import { resolveLocalFilePath } from '../src/lib/local-backend';

async function run(filePath: string, label: string) {
  const buf = fs.readFileSync(filePath);
  const file = new File([buf], path.basename(filePath), {
    type: filePath.toLowerCase().endsWith('.pptx')
      ? 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      : 'image/png',
  });
  const imported = await importEditablePptFiles(null, null, label, [file], {
    parseMode: 'balanced',
    languageHint: 'auto',
    detectTables: false,
    detectIcons: false,
    rebuildShapes: true,
    exportStrategy: 'hybrid',
  });
  const page = imported.pages[0];
  const elements = imported.elements.filter((item) => item.page_id === page.id);
  const exported = await exportEditablePptDeck({
    projectName: label,
    aspectRatio: imported.aspectRatioGuess,
    pages: [page],
    elementsByPage: { [page.id]: elements },
  });
  const outPath = resolveLocalFilePath(exported.key);
  const zip = await JSZip.loadAsync(fs.readFileSync(outPath));
  const slideXml = await zip.file('ppt/slides/slide1.xml')?.async('text');
  const mediaNames = Object.keys(zip.files).filter((name) => name.startsWith('ppt/media/'));
  const spCount = (slideXml?.match(/<p:sp\b/g) || []).length;
  const picCount = (slideXml?.match(/<p:pic\b/g) || []).length;
  const textTagCount = (slideXml?.match(/<a:t>/g) || []).length;
  console.log(JSON.stringify({ label, pageMode: page.page_mode, editableScore: page.editable_score, outPath, spCount, picCount, textTagCount, mediaCount: mediaNames.length }, null, 2));
}

async function main() {
  await run('/Users/congrong/Documents/AI平台/output/rxbio/RXBIO国际市场拓展商业计划书_董事会汇报版.pptx', 'native-export-check');
  await run('/Users/congrong/Documents/AI平台/output/skill-runs/1781121873711-1eac21e3/input/page_001.png', 'image-export-check');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
