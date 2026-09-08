"""Generate a reviewable patch, never edit the supplied ATO checkout.

This patch is based on the inspected 10dbbf5 source. All replacements fail closed
if their exact anchor is missing/ambiguous. Run git apply --check before applying.
"""
import difflib
import hashlib
import json
from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parents[1]
SOURCE=Path(sys.argv[1]).resolve()
patch=[]
audit={}

def replace(text,old,new):
    if text.count(old)!=1: raise ValueError('Source mismatch: '+old[:100])
    return text.replace(old,new)

def update(name,edit):
    raw=(SOURCE/name).read_bytes()
    before=raw.decode('utf-8').replace('\r\n','\n')
    after=edit(before)
    audit[name]={'beforeSha256':hashlib.sha256(raw).hexdigest()}
    patch.extend(difflib.unified_diff(before.splitlines(True),after.splitlines(True),fromfile='a/'+name,tofile='b/'+name,n=3))

def router(text):
    anchor='    if (path.endsWith("/map/index.html")'
    return replace(text,anchor,'    if (path.endsWith("/babelian/index.html") || path.endsWith("/babelian")) return "babelian";\n'+anchor)
update('assets/page-focus-router.js',router)

def php(text):
    text=replace(text,"'heroes', 'aibp', 'story'];","'heroes', 'aibp', 'story', 'babelian'];")
    text=replace(text,"      'story' => null,","      'story' => null,\n      'babelian' => null,")
    text=replace(text,"      'story' => 0,","      'story' => 0,\n      'babelian' => 0,")
    anchor="  $expectedRevision = $payload['expectedRevision'] ?? null;"
    guard="""  // Fence the save against an account or campaign switch during the request.
  if ($payloadSection === 'babelian') {
    if (($payload['ownerId'] ?? '') !== $user['id']) {
      respond(403, ['ok' => false, 'error' => 'Babelian account changed.']);
    }
    $activeBabelianProfile = (string) ($campaign['sections']['dashboard']['activeProfileId'] ?? 'default');
    if (($payload['profileId'] ?? '') !== $activeBabelianProfile) {
      respond(409, ['ok' => false, 'code' => 'BABELIAN_CONTEXT_CHANGED', 'error' => 'Babelian campaign changed.']);
    }
    if (!isset($payload['expectedRevision'])) {
      respond(400, ['ok' => false, 'error' => 'Babelian revision required.']);
    }
  }
"""
    return replace(text,anchor,guard+anchor)
update('api/campaign-state.php',php)

def dashboard(text):
    anchor='          <a class="record-card-link hero-card-link"'
    text=replace(text,anchor,'          <a class="record-card-link" href="./babelian/index.html">巴别语解密</a>\n'+anchor)
    text=replace(text,'          heroes: serverSections.heroes || null,','          heroes: serverSections.heroes || null,\n          babelian: serverSections.babelian || null,')
    # Restore babelian after the dashboard import so its campaign guard matches.
    anchor='          campaignSectionRevision = Math.max(0, Number(dashboardSave?.revision || campaignSectionRevision));'
    text=replace(text,anchor,'          if (sections?.babelian) await saveImportedBabelian(sections.babelian);\n'+anchor)
    anchor='    function downloadJsonPayload(payload) {'
    helper='''    async function saveImportedBabelian(state) {
      const read = async query => {
        const response = await fetch(`${authUrl}${query}`, { cache: "no-store" });
        const value = await response.json();
        if (!response.ok || !value.ok) throw new Error(value.error || "巴别语存档读取失败");
        return value;
      };
      const me = await read("?action=me");
      if (!me.authenticated) throw new Error("请先登录后再导入巴别语存档。");
      const current = await read("?section=babelian");
      const dashboard = await read("?section=dashboard");
      const response = await fetch(`${authUrl}?section=babelian`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section: "babelian", state, ownerId: me.user.id,
          profileId: String(dashboard.state?.activeProfileId || "default"), expectedRevision: current.revision }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "巴别语存档未导入，请单独重试。");
    }

'''
    text=replace(text,anchor,helper+anchor)
    # Preserve ONLY unsent Babelian drafts, with account/campaign-qualified keys.
    text=replace(text,'        localStorage.clear();','''        const babelianPending = Object.keys(localStorage)
          .filter(key => key.startsWith("ato-babelian-pending-v1:"))
          .map(key => [key, localStorage.getItem(key)]);
        localStorage.clear();
        for (const [key, value] of babelianPending) localStorage.setItem(key, value);''')
    return text
update('index.html',dashboard)

def story_html(text):
    anchor='      <a class="home-link" href="../index.html">返回主控台</a>'
    return replace(text,anchor,anchor+'\n      <a id="babelianToolLink" class="home-link" href="../babelian/index.html">巴别语解密</a>')
update('story/index.html',story_html)

def story_js(text):
    anchor='    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);'
    return replace(text,anchor,anchor+'''\n    const babelianLink = document.getElementById("babelianToolLink");
    if (babelianLink) babelianLink.href = `../babelian/index.html?${params.toString()}`;''')
update('story/assets/app.js',story_js)

JAVA='tools/packaging/android/app/src/main/java/com/ato/assistant/'
def java_api(text):
    text=replace(text,'"heroes", "aibp", "story"};','"heroes", "aibp", "story", "babelian"};')
    anchor='    int revision = revisions.optInt(section, 0);'
    guard='''    if ("babelian".equals(section)) {
      if (!user().optString("id").equals(payload.optString("ownerId")))
        throw new ApiException(403, error("Babelian account changed."));
      JSONObject dashboard = campaign.getJSONObject("sections").optJSONObject("dashboard");
      String active = dashboard == null ? "default" : dashboard.optString("activeProfileId", "default");
      if (!active.equals(payload.optString("profileId")))
        throw new ApiException(409, error("Babelian campaign changed."));
      if (!payload.has("expectedRevision")) throw new ApiException(400, error("Babelian revision required."));
    }
'''
    return replace(text,anchor,guard+anchor)
update(JAVA+'LocalCampaignApi.java',java_api)

def java_main(text):
    text=replace(text,'  private WebView webView;',(ROOT/'integration/native-export-fields.txt').read_text(encoding='utf-8')+'\n  private WebView webView;')
    anchor='    super.onActivityResult(requestCode, resultCode, data);'
    text=replace(text,anchor,anchor+'\n    if (requestCode == BABELIAN_SAVE_REQUEST) { finishBabelianSave(resultCode, data); return; }')
    anchor='  private final class LocalApiBridge {'
    return replace(text,anchor,anchor+'\n'+(ROOT/'integration/native-export-method.txt').read_text(encoding='utf-8'))
update(JAVA+'MainActivity.java',java_main)

target=ROOT/'integration/ato-assistant.patch'
target.write_text(''.join(patch),encoding='utf-8',newline='\n')
(ROOT/'integration/patch-baseline.json').write_text(json.dumps({'commit':'10dbbf5','files':audit},indent=2)+'\n',encoding='utf-8')
print(f'Generated {target.name}: {len(audit)} files. Source checkout was not modified.')
