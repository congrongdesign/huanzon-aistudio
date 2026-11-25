# coding: utf-8
import subprocess,time,pathlib,json
root=pathlib.Path('/tmp/font-daily-1123');exe=str(root/'chrome-tab');pid='14880';win='1465085678';tab='1465085680'
for id in ['678826','675654','669590','669570','669244','665083','652658','652279','650202']:
 nav=root/'nav.js';nav.write_text("location.href='https://www.uisdc.com/group/%s.html';'nav'"%id)
 subprocess.run([exe,pid,win,tab,str(nav)],check=True,capture_output=True,text=True)
 time.sleep(2.5)
 for j in range(3):
  scroll=root/'scroll.js';scroll.write_text(f'window.scrollTo(0, document.body.scrollHeight*{(j+1)}/3);"scroll-{j}"')
  subprocess.run([exe,pid,win,tab,str(scroll)],check=True,capture_output=True,text=True);time.sleep(.8)
 out=subprocess.run([exe,pid,win,tab,str(root/'read.js')],check=True,capture_output=True,text=True).stdout
 x=json.loads(out);(root/f'browser-{id}.json').write_text(json.dumps(x,ensure_ascii=False,indent=2))
 print(id,x['title'],len(x['body']),len(x['images']),flush=True)
