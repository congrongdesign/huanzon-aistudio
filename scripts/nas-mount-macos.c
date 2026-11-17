// Small desktop helper: use macOS NetFS and Keychain with no password in argv
// or configuration, and no authentication windows during background retries.
#include <CoreFoundation/CoreFoundation.h>
#include <NetFS/NetFS.h>
#include <stdio.h>
#include <string.h>

int main(int argc, char **argv) {
  if (argc != 2) return 2;
  CFStringRef value = CFStringCreateWithCString(NULL, argv[1], kCFStringEncodingUTF8);
  CFURLRef raw = CFURLCreateWithBytes(NULL, (const UInt8 *)argv[1], strlen(argv[1]), kCFStringEncodingUTF8, NULL);
  CFURLRef url = raw;
  if (!url) { printf("{\"code\":22}\n"); CFRelease(value); return 0; }
  CFMutableDictionaryRef options = CFDictionaryCreateMutable(NULL, 0,
    &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
  CFDictionarySetValue(options, kNAUIOptionKey, kNAUIOptionNoUI);
  CFArrayRef mounts = NULL;
  int code = NetFSMountURLSync(url, NULL, NULL, NULL, options, NULL, &mounts);
  printf("{\"code\":%d}\n", code);
  if (mounts) CFRelease(mounts);
  CFRelease(options); CFRelease(url); CFRelease(value);
  return 0;
}
