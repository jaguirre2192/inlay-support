#!/bin/zsh
# Builds friend codes with the iPhone app's own encoder and reads codes back with its own
# decoder, so the web atlas's friends.js is tested against the real thing, not a copy of it.
#
#   tools/friend-codes.sh make  > atlas/dev/friend-fixtures.json   # codes the app writes
#   tools/friend-codes.sh read  < codes.txt                        # what the app reads (one per line)
#
# It compiles `SharedAtlas` (App/Atlas/Friends.swift) and `LinkCode` (App/Atlas/LinkCode.swift)
# from a local Inlay checkout (INLAY, default ~/Documents/Apps/Inlay) with a small driver.
set -euo pipefail
INLAY=${INLAY:-$HOME/Documents/Apps/Inlay}
MODE=${1:-make}
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

cp "$INLAY/App/Atlas/LinkCode.swift" "$WORK/LinkCode.swift"
{ echo 'import Foundation'; awk '/^struct SharedAtlas/,/^struct Friend:/' "$INLAY/App/Atlas/Friends.swift" | sed '$d'; } > "$WORK/SharedAtlas.swift"

cat > "$WORK/main.swift" <<'SWIFT'
import Foundation

func emit(_ value: Any) {
    let data = try! JSONSerialization.data(withJSONObject: value, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes])
    print(String(data: data, encoding: .utf8)!)
}
func describe(_ a: SharedAtlas?) -> Any {
    guard let a else { return NSNull() }
    var out: [String: Any] = ["name": a.name, "visited": a.visited]
    if let live = a.liveID { out["liveID"] = live }
    return out
}

let mode = CommandLine.arguments.dropFirst().first ?? "make"
if mode == "read" {
    var results: [Any] = []
    while let line = readLine(strippingNewline: true) {
        let text = line.replacingOccurrences(of: "\\n", with: "\n")
        let shared = URL(string: text).flatMap { SharedAtlas(url: $0) } ?? SharedAtlas(text: text)
        results.append(["input": line, "read": describe(shared)])
    }
    emit(results)
} else {
    struct Plain: Encodable { let name: String; let visited: [String] }
    func legacy(_ name: String, _ visited: [String]) -> String {
        // The UI tests' INLAY1 code (UITests/StoreCaptureTests.swift): uncompressed JSON.
        "INLAY1-" + LinkCode.webSafe(try! JSONEncoder().encode(Plain(name: name, visited: visited)))
    }
    let every = ["AD","AE","AF","AG","AL","AM","AO","AR","AT","AU","AZ","BA","BB","BD","BE","BF","BG","BH","BI","BJ","BN","BO","BR","BS","BT","BW","BY","BZ","CA","CD","CF","CG","CH","CI","CL","CM","CN","CO","CR","CU","CV","CY","CZ","DE","DJ","DK","DM","DO","DZ","EC","EE","EG","ER","ES","ET","FI","FJ","FM","FR","GA","GB","GD","GE","GH","GM","GN","GQ","GR","GT","GW","GY","HN","HR","HT","HU","ID","IE","IL","IN","IQ","IR","IS","IT","JM","JO","JP","KE","KG","KH","KI","KM","KN","KP","KR","KW","KZ","LA","LB","LC","LI","LK","LR","LS","LT","LU","LV","LY","MA","MC","MD","ME","MG","MH","MK","ML","MM","MN","MR","MT","MU","MV","MW","MX","MY","MZ","NA","NE","NG","NI","NL","NO","NP","NR","NZ","OM","PA","PE","PG","PH","PK","PL","PS","PT","PW","PY","QA","RO","RS","RU","RW","SA","SB","SC","SD","SE","SG","SI","SK","SL","SM","SN","SO","SR","SS","ST","SV","SY","SZ","TD","TG","TH","TJ","TL","TM","TN","TO","TR","TT","TV","TZ","UA","UG","US","UY","UZ","VA","VC","VE","VN","VU","WS","XK","YE","ZA","ZM","ZW","IT-25","IT-21","US-CA","US-NY","CA-BC"]
    let cases: [(String, [String], String?)] = [
        ("Sam", ["ES", "FR", "GR", "IT", "JP", "PE", "VN", "US"], nil),
        ("  Jorge  ", ["IT", "FR", "PR"], nil),
        ("Ana María", ["MX", "ES", "AR", "IT-25"], nil),
        ("Søren / Bø", ["DK", "NO", "IS"], nil),
        ("佐藤 花子", ["JP", "KR", "TW", "FR"], nil),
        ("Léa \"the\" Explorer\u{0007}", ["FR", "BE"], nil),
        ("", ["FR"], nil),
        ("Everywhere", every, nil),
        ("Sam", ["FR"], "1b4e28ba-2fa1-11d2-883f-0016d3cca427"),
    ]
    var fixtures: [Any] = []
    for (name, visited, live) in cases {
        let shared = SharedAtlas(name: name, visited: Set(visited), liveID: live)
        let validated = SharedAtlas.validated(name: shared.name, visited: shared.visited, liveID: shared.liveID)
        let json = validated.flatMap { try? AtlasJSON.encoder.encode($0) }.map { String(data: $0, encoding: .utf8)! }
        fixtures.append([
            "input": ["name": name, "visited": visited, "liveID": live as Any? ?? NSNull()],
            "json": json as Any? ?? NSNull(),
            "code": shared.code as Any? ?? NSNull(),
            "inviteCode": shared.inviteCode as Any? ?? NSNull(),
            "url": shared.url?.absoluteString as Any? ?? NSNull(),
            "invitation": shared.invitation as Any? ?? NSNull(),
            "read": describe(shared.inviteCode.flatMap { SharedAtlas(text: $0) }),
        ])
    }
    let sam = legacy("Sam", ["ES", "FR", "GR", "IT", "JP", "PE", "VN", "US"])
    fixtures.append(["input": "INLAY1 from UITests/StoreCaptureTests.swift", "code": sam, "url": "inlay://friend?d=" + sam,
                     "read": describe(SharedAtlas(url: URL(string: "inlay://friend?d=" + sam)!))])
    emit(fixtures)
}
SWIFT

swiftc -O -o "$WORK/friend-codes" "$WORK/LinkCode.swift" "$WORK/SharedAtlas.swift" "$WORK/main.swift" 2>&1 >&2 | grep -v warning >&2 || true
"$WORK/friend-codes" "$MODE"
