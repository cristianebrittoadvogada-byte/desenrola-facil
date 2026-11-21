import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const renderConfig = await readFile(new URL("../../../render.yaml", import.meta.url), "utf8");
const publishPackageRoot = "../../../outputs/mentoria-render-release/";
const packageBlueprint = await readFile(new URL(`${publishPackageRoot}render.yaml`, import.meta.url), "utf8");
const completeReleaseRoot = "../../../outputs/desenrola-facil-render-release/";

test("Blueprint separa a página comercial e o painel como sites estáticos sem segredos", () => {
  assert.match(renderConfig, /runtime:\s*static/);
  assert.match(renderConfig, /rootDir:\s*app\/supabase\/web\/mentoria/);
  assert.match(renderConfig, /staticPublishPath:\s*\./);
  assert.match(renderConfig, /name:\s*desenrola-facil-mentoria/);
  assert.match(renderConfig, /name:\s*desenrola-facil-painel/);
  assert.match(renderConfig, /rootDir:\s*app\/supabase\/web\s*\n\s*buildCommand:/);
  assert.match(renderConfig, /connect-src 'self' https:\/\/nmkneyzyxxhebkurgimh\.supabase\.co/);
  assert.doesNotMatch(renderConfig, /envVars:|service_role|access_token|secret/i);
  assert.match(renderConfig, /Content-Security-Policy/);
  assert.doesNotMatch(renderConfig, /unsafe-inline|unsafe-eval/);
});

test("pacote privado contém só a página e o Blueprint, sincronizados com a fonte", async () => {
  const filenames = ["index.html", "styles.css", "page.js", "lead-whatsapp.mjs", "supabase-config.js"];
  for (const filename of filenames) {
    const [source, packaged] = await Promise.all([
      readFile(new URL(`../web/mentoria/${filename}`, import.meta.url)),
      readFile(new URL(`${publishPackageRoot}${filename}`, import.meta.url)),
    ]);
    assert.deepEqual(packaged, source, `${filename} precisa corresponder à fonte`);
  }
  assert.match(packageBlueprint, /runtime:\s*static/);
  assert.match(packageBlueprint, /staticPublishPath:\s*\./);
  assert.doesNotMatch(packageBlueprint, /service_role|access_token|API_KEY/i);
});

test("pacote privado de publicação contém página e painel separados, sem credenciais", async () => {
  const packagedBlueprint = await readFile(new URL(`${completeReleaseRoot}render.yaml`, import.meta.url), "utf8");
  assert.equal(packagedBlueprint, renderConfig);
  const files = [
    "app/supabase/web/index.html", "app/supabase/web/styles.css", "app/supabase/web/app.js",
    "app/supabase/web/app-config.js", "app/supabase/web/_headers",
    "app/supabase/web/mentoria/index.html", "app/supabase/web/mentoria/styles.css",
    "app/supabase/web/mentoria/page.js", "app/supabase/web/mentoria/lead-whatsapp.mjs",
    "app/supabase/web/mentoria/supabase-config.js",
  ];
  for (const file of files) {
    const [source, packaged] = await Promise.all([
      readFile(new URL(`../../../${file}`, import.meta.url)),
      readFile(new URL(`${completeReleaseRoot}${file}`, import.meta.url)),
    ]);
    assert.deepEqual(packaged, source, `${file} precisa corresponder à fonte`);
  }
  const config = await readFile(new URL(`${completeReleaseRoot}app/supabase/web/app-config.js`, import.meta.url), "utf8");
  const salesConfig = await readFile(new URL(`${completeReleaseRoot}app/supabase/web/mentoria/supabase-config.js`, import.meta.url), "utf8");
  assert.match(config, /sb_publishable_/);
  assert.doesNotMatch(config, /service_role|sb_secret_|asaas|meta_app_secret/i);
  assert.match(salesConfig, /sb_publishable_/);
  assert.doesNotMatch(salesConfig, /service_role|sb_secret_|asaas|meta_app_secret/i);
  assert.match(salesConfig, /nmkneyzyxxhebkurgimh\.supabase\.co/);
  assert.match(packagedBlueprint, /name:\s*desenrola-facil-mentoria/);
  assert.match(packagedBlueprint, /name:\s*desenrola-facil-painel/);
});

