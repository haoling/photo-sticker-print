"""mDNS (DNS-SD) で LAN 内の IPP プリンタを探して一覧表示する。

host ネットワークのコンテナ内で動かす想定（tools/find-printer.sh から呼ぶ）。
"""

import sys
import time

from zeroconf import IPVersion, ServiceBrowser, Zeroconf

SERVICES = ["_ipp._tcp.local.", "_ipps._tcp.local.", "_printer._tcp.local."]
WAIT = float(sys.argv[1]) if len(sys.argv) > 1 else 6.0

found: dict[str, dict] = {}


class Listener:
    def add_service(self, zc, type_, name):
        info = zc.get_service_info(type_, name, timeout=3000)
        if not info:
            return
        txt = {
            k.decode(errors="replace"): (v.decode(errors="replace") if v else "")
            for k, v in info.properties.items()
        }
        found[f"{type_}{name}"] = {
            "name": name.removesuffix("." + type_),
            "type": type_.removesuffix(".local."),
            "addrs": info.parsed_addresses(IPVersion.V4Only),
            "port": info.port,
            "rp": txt.get("rp", ""),
            "model": txt.get("ty") or txt.get("product", "").strip("()"),
            "uuid": txt.get("UUID", ""),
        }

    def update_service(self, zc, type_, name):
        self.add_service(zc, type_, name)

    def remove_service(self, zc, type_, name):
        pass


zc = Zeroconf(ip_version=IPVersion.V4Only)
listener = Listener()
browsers = [ServiceBrowser(zc, s, listener) for s in SERVICES]
time.sleep(WAIT)
zc.close()

if not found:
    print("プリンタが見つかりませんでした。")
    print("- host ネットワークで動いているか（Docker Desktop の Mac/Windows では mDNS は届きません）")
    print("- プリンタと同じ LAN / VLAN か")
    sys.exit(1)

for v in sorted(found.values(), key=lambda x: (x["model"], x["name"])):
    ip = v["addrs"][0] if v["addrs"] else "?"
    print(f"{v['model'] or v['name']}")
    print(f"  名前: {v['name']}")
    print(f"  IP:   {ip}  ポート: {v['port']}  サービス: {v['type']}")
    if v["rp"]:
        print(f"  IPP URI: ipp://{ip}:{v['port']}/{v['rp']}")
    if v["uuid"]:
        print(f"  UUID: {v['uuid']}")
