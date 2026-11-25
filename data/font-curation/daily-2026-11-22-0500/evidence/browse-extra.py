# coding:utf-8
import pathlib,subprocess,json,time
p=pathlib.Path('/tmp/font-daily-1122')
for label,url in [(i,'https://www.uisdc.com/group/'+i+'.html')for i in ['674828','672780','659394','660015']]:
 p.joinpath('navigate.js').write_text('location.href='+json.dumps(url)+";'navigation-requested'")
 subprocess.run([str(p/'chrome-tab'),'7792','1465085013','1465085100',str(p/'navigate.js')],capture_output=True,check=True)
 for a in range(4):
  time.sleep(.5);o=subprocess.run([str(p/'chrome-tab'),'7792','1465085013','1465085100',str(p/'read.js')],capture_output=True,text=True,check=True)
  try:d=json.loads(o.stdout)
  except:continue
  if d['url']==url and len(d['body'])>200:break
 p.joinpath('browser-'+label+'.json').write_text(o.stdout);print(label,d['title'],flush=True)
