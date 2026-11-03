import asyncio
import os
import sys
import time
from datetime import datetime, timezone
import httpx
from playwright.sync_api import sync_playwright

BACKEND = "http://127.0.0.1:8000"
FRONTEND = "http://localhost:5174"
ARTIFACTS_DIR = r"C:\Users\Asus\.gemini\antigravity-ide\brain\349cca33-4b77-4be3-9efb-934baa36fcac"

def timestamp():
    return datetime.now(timezone.utc).isoformat()

def inject_port_scan():
    ports = [21, 22, 80, 443, 8080, 3306, 5432, 25, 110, 143, 993]
    with httpx.Client(timeout=5.0) as client:
        for p in ports:
            event = {
                "type": "network_event",
                "timestamp": timestamp(),
                "source_node": "node-99",
                "source_ip": "10.0.0.66",
                "source_hostname": "unknown-external",
                "target_node": "node-2",
                "target_ip": "192.168.1.10",
                "target_hostname": "web-srv-01",
                "event_type": "port_scan_probe",
                "port": p,
                "threat": False,
                "severity": "none",
                "message": f"SYN probe to port {p}",
            }
            client.post(f"{BACKEND}/inject", json=event)
            time.sleep(0.04)

def inject_brute_force():
    with httpx.Client(timeout=5.0) as client:
        for i in range(6):
            event = {
                "type": "network_event",
                "timestamp": timestamp(),
                "source_node": "node-99",
                "source_ip": "10.0.0.66",
                "source_hostname": "unknown-external",
                "target_node": "node-2",
                "target_ip": "192.168.1.10",
                "target_hostname": "web-srv-01",
                "event_type": "auth_failure",
                "port": 22,
                "threat": False,
                "severity": "none",
                "message": f"SSH auth failed — attempt {i+1}",
            }
            client.post(f"{BACKEND}/inject", json=event)
            time.sleep(0.04)

def inject_data_exfil():
    with httpx.Client(timeout=5.0) as client:
        event = {
            "type": "network_event",
            "timestamp": timestamp(),
            "source_node": "node-99",
            "source_ip": "10.0.0.66",
            "source_hostname": "unknown-external",
            "target_node": "node-2",
            "target_ip": "192.168.1.10",
            "target_hostname": "web-srv-01",
            "event_type": "data_transfer",
            "port": 443,
            "size_kb": 65000,
            "threat": False,
            "severity": "none",
            "message": "Large outbound transfer",
        }
        client.post(f"{BACKEND}/inject", json=event)

def run():
    print("=== Starting Playwright Verification ===")
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]
        )

        # ---------------------------------------------------------
        # Test A: Port Scan -> One orange card, badge MEDIUM (1920x1020)
        # ---------------------------------------------------------
        print("\n--- Test A: Port Scan (1920x1020) ---")
        context = browser.new_context(viewport={"width": 1920, "height": 1020})
        page = context.new_page()
        page.goto(FRONTEND)
        page.wait_for_selector("#attack-log-toggle", timeout=10000)
        time.sleep(2)

        inject_port_scan()
        time.sleep(1.5)

        badge_text = page.locator(".attack-log__pill-badge").inner_text()
        print(f"Pill badge count: {badge_text}")
        assert badge_text == "1", f"Expected 1, got {badge_text}"

        page.click("#attack-log-toggle")
        page.wait_for_selector(".attack-log__box", timeout=5000)
        time.sleep(0.5)

        card = page.locator(".attack-log__record")
        assert card.count() == 1, f"Expected 1 card, got {card.count()}"

        card_name = page.locator(".attack-log__record-name").inner_text()
        print(f"Attack name: {card_name}")
        assert card_name == "Port Scan", f"Expected 'Port Scan', got '{card_name}'"

        badge = page.locator(".attack-log__badge").inner_text()
        print(f"Badge text: {badge}")
        assert badge == "MEDIUM", f"Expected 'MEDIUM', got '{badge}'"

        # Check card border/color
        classes = card.get_attribute("class")
        assert "attack-log__record--orange" in classes, f"Expected orange card, got {classes}"

        # Screenshot A
        ss_a = os.path.join(ARTIFACTS_DIR, "screenshot_a_1920x1020.png")
        page.screenshot(path=ss_a)
        print(f"Saved Screenshot A: {ss_a}")

        context.close()

        # ---------------------------------------------------------
        # Test B: Brute Force -> One dark red card, badge HIGH (1920x1020)
        # ---------------------------------------------------------
        print("\n--- Test B: Brute Force (1920x1020) ---")
        context = browser.new_context(viewport={"width": 1920, "height": 1020})
        page = context.new_page()
        page.goto(FRONTEND)
        page.wait_for_selector("#attack-log-toggle", timeout=10000)
        time.sleep(2)

        inject_brute_force()
        time.sleep(1.5)

        badge_text = page.locator(".attack-log__pill-badge").inner_text()
        print(f"Pill badge count: {badge_text}")
        assert badge_text == "1", f"Expected 1, got {badge_text}"

        page.click("#attack-log-toggle")
        page.wait_for_selector(".attack-log__box", timeout=5000)
        time.sleep(0.5)

        card = page.locator(".attack-log__record")
        assert card.count() == 1, f"Expected 1 card, got {card.count()}"

        card_name = page.locator(".attack-log__record-name").inner_text()
        print(f"Attack name: {card_name}")
        assert card_name == "Brute Force", f"Expected 'Brute Force', got '{card_name}'"

        badge = page.locator(".attack-log__badge").inner_text()
        print(f"Badge text: {badge}")
        assert badge == "HIGH", f"Expected 'HIGH', got '{badge}'"

        classes = card.get_attribute("class")
        assert "attack-log__record--darkred" in classes, f"Expected darkred card, got {classes}"

        # Screenshot B
        ss_b = os.path.join(ARTIFACTS_DIR, "screenshot_b_1920x1020.png")
        page.screenshot(path=ss_b)
        print(f"Saved Screenshot B: {ss_b}")

        context.close()

        # ---------------------------------------------------------
        # Test C: Data Exfil -> NO card, badge count stays 0 (1920x1020)
        # ---------------------------------------------------------
        print("\n--- Test C: Data Exfil (1920x1020) ---")
        context = browser.new_context(viewport={"width": 1920, "height": 1020})
        page = context.new_page()
        page.goto(FRONTEND)
        page.wait_for_selector("#attack-log-toggle", timeout=10000)
        time.sleep(2)

        inject_data_exfil()
        time.sleep(1.5)

        badge_text = page.locator(".attack-log__pill-badge").inner_text()
        print(f"Pill badge count after exfil: {badge_text}")
        assert badge_text == "0", f"Expected 0, got {badge_text}"

        page.click("#attack-log-toggle")
        page.wait_for_selector(".attack-log__box", timeout=5000)
        cards = page.locator(".attack-log__record")
        print(f"Card count: {cards.count()}")
        assert cards.count() == 0, f"Expected 0 cards, got {cards.count()}"

        empty_text = page.locator(".attack-log__empty").inner_text()
        print(f"Empty state text: {empty_text}")
        assert empty_text == "No attacks detected yet."

        context.close()

        # ---------------------------------------------------------
        # Test D: Port Scan + Brute Force -> ONE combined card
        # ---------------------------------------------------------
        print("\n--- Test D: Combined Port Scan + Brute Force (1920x1020) ---")
        context = browser.new_context(viewport={"width": 1920, "height": 1020})
        page = context.new_page()
        page.goto(FRONTEND)
        page.wait_for_selector("#attack-log-toggle", timeout=10000)
        time.sleep(2)

        print("Injecting Port Scan...")
        inject_port_scan()
        time.sleep(1.5)
        print("Injecting Brute Force...")
        inject_brute_force()
        time.sleep(1.5)

        badge_text = page.locator(".attack-log__pill-badge").inner_text()
        print(f"Pill badge count: {badge_text}")
        assert badge_text == "1", f"Expected 1 record in badge, got {badge_text}"

        page.click("#attack-log-toggle")
        page.wait_for_selector(".attack-log__box", timeout=5000)
        time.sleep(0.5)

        card = page.locator(".attack-log__record")
        print(f"Card count: {card.count()}")
        assert card.count() == 1, f"Expected 1 combined card, got {card.count()}"

        card_name = page.locator(".attack-log__record-name").inner_text()
        print(f"Combined attack name: {card_name}")
        assert card_name == "Port Scan + Brute Force", f"Expected 'Port Scan + Brute Force', got '{card_name}'"

        badge = page.locator(".attack-log__badge").inner_text()
        print(f"Badge text: {badge}")
        assert badge == "HIGH", f"Expected 'HIGH', got '{badge}'"

        attempts = page.locator(".attack-log__record-line3").inner_text()
        print(f"Attempts line: {attempts}")
        assert "10 ports scanned · 5 failed logins" in attempts

        classes = card.get_attribute("class")
        assert "attack-log__record--darkred" in classes

        # Screenshot D
        ss_d = os.path.join(ARTIFACTS_DIR, "screenshot_d_1920x1020.png")
        page.screenshot(path=ss_d)
        print(f"Saved Screenshot D: {ss_d}")

        context.close()

        # ---------------------------------------------------------
        # Test E: Layout, Edge Spacing, Text Colors, No Ellipsis across viewports
        # ---------------------------------------------------------
        print("\n--- Test E: Edge spacing, text colors, and no clipping ---")
        viewports = [
            (1920, 1020),
            (1440, 860),
            (390, 844),
        ]

        ALLOWED_TEXT_COLORS = {
            "rgb(242, 246, 244)", # #F2F6F4
            "rgb(200, 211, 205)", # #C8D3CD
            "rgb(255, 226, 194)", # #FFE2C2 (medium badge)
            "rgb(255, 215, 220)", # #FFD7DC (high badge)
        }

        for vw, vh in viewports:
            print(f"\nChecking viewport {vw}x{vh}...")
            context = browser.new_context(viewport={"width": vw, "height": vh})
            page = context.new_page()
            page.goto(FRONTEND)
            page.wait_for_selector("#attack-log-toggle", timeout=10000)
            time.sleep(2)

            # Inject combined attack
            inject_port_scan()
            time.sleep(1.0)
            inject_brute_force()
            time.sleep(1.0)

            page.click("#attack-log-toggle")
            page.wait_for_selector(".attack-log__box", timeout=5000)
            time.sleep(0.5)

            box_box = page.locator(".attack-log__box").bounding_box()
            assert box_box is not None, "Box not found"
            print(f"Box rect: x={box_box['x']}, y={box_box['y']}, w={box_box['width']}, h={box_box['height']}")

            # Free space checks
            left_space = box_box['x']
            right_space = vw - (box_box['x'] + box_box['width'])
            top_space = box_box['y']
            bottom_space = vh - (box_box['y'] + box_box['height'])
            print(f"Free space: left={left_space:.1f}px, right={right_space:.1f}px, top={top_space:.1f}px, bottom={bottom_space:.1f}px")

            assert left_space >= 15.9, f"Left space too small: {left_space}"
            assert right_space >= 15.9, f"Right space too small: {right_space}"
            assert top_space >= 15.9, f"Top space too small: {top_space}"
            assert bottom_space >= 15.9, f"Bottom space too small: {bottom_space}"

            # Check full IP and host visibility
            content = page.locator(".attack-log__box").inner_text()
            assert "192.168.1.10" in content, "Target IP 192.168.1.10 not found!"
            assert "unknown-external" in content, "Attacker source unknown-external not found!"
            assert "10.0.0.66" in content, "Attacker IP 10.0.0.66 not found!"
            assert "web-srv-01" in content, "Target host web-srv-01 not found!"

            # Check clipping & ellipsis
            elements = page.query_selector_all(".attack-log__box *")
            for el in elements:
                # evaluate properties
                props = el.evaluate("""node => {
                    const style = window.getComputedStyle(node);
                    return {
                        tag: node.tagName,
                        text: (node.innerText || '').trim(),
                        color: style.color,
                        textOverflow: style.textOverflow,
                        scrollWidth: node.scrollWidth,
                        clientWidth: node.clientWidth,
                        opacity: style.opacity
                    };
                }""")
                assert props["textOverflow"] != "ellipsis", f"Element {props['tag']} has textOverflow: ellipsis"
                # Check scrollWidth <= clientWidth (+1 for rounding)
                if props["tag"] not in ["svg", "path"]:
                    assert props["scrollWidth"] <= props["clientWidth"] + 1, (
                        f"Element {props['tag']} clipped! scrollWidth={props['scrollWidth']}, clientWidth={props['clientWidth']}, text='{props['text']}'"
                    )
                # Check text color if element has direct text content
                has_direct_text = el.evaluate("""node => {
                    for (let child of node.childNodes) {
                        if (child.nodeType === Node.TEXT_NODE && child.textContent.trim().length > 0) {
                            return true;
                        }
                    }
                    return false;
                }""")
                if has_direct_text:
                    c = props["color"]
                    assert c in ALLOWED_TEXT_COLORS, f"Element {props['tag']} has invalid text color: {c} (text: '{props['text']}')"
                    assert float(props["opacity"]) >= 0.99, f"Element {props['tag']} has opacity < 1: {props['opacity']}"

            # Capture 390x844 screenshot
            if vw == 390:
                ss_mobile = os.path.join(ARTIFACTS_DIR, "screenshot_390x844.png")
                page.screenshot(path=ss_mobile)
                print(f"Saved Screenshot Mobile (390x844): {ss_mobile}")

            context.close()

        # ---------------------------------------------------------
        # Test F: CSV Download, Clear, Repeat Merging, Refresh Empties
        # ---------------------------------------------------------
        print("\n--- Test F: CSV report, Clear, Repeat merging, Refresh ---")
        context = browser.new_context(viewport={"width": 1920, "height": 1020})
        page = context.new_page()
        page.goto(FRONTEND)
        page.wait_for_selector("#attack-log-toggle", timeout=10000)
        time.sleep(2)

        # Inject Port Scan then Brute force
        inject_port_scan()
        time.sleep(1.0)
        inject_brute_force()
        time.sleep(1.0)

        page.click("#attack-log-toggle")
        page.wait_for_selector(".attack-log__box", timeout=5000)

        # Repeat within 30s: inject port scan again
        print("Injecting repeat Port Scan within 30s...")
        inject_port_scan()
        time.sleep(1.5)

        # Check repeat count
        count_text = page.locator(".attack-log__record-count").inner_text()
        print(f"Repeat count on card: {count_text}")
        assert "×2" in count_text, f"Expected ×2, got {count_text}"

        # Test CSV download
        print("Testing REPORT CSV download...")
        with page.expect_download() as download_info:
            page.click("button:has-text('REPORT')")
        download = download_info.value
        csv_path = os.path.join("scratch", "test_report.csv")
        download.save_as(csv_path)
        with open(csv_path, "r", encoding="utf-8-sig") as f:
            csv_content = f.read()
        print(f"CSV Content:\n{csv_content}")
        assert "Port Scan + Brute Force" in csv_content
        assert "HIGH" in csv_content
        assert "data_exfil" not in csv_content.lower()
        assert "10.0.0.66" in csv_content
        assert "web-srv-01" in csv_content
        assert "192.168.1.10" in csv_content

        # Test CLEAR
        print("Testing CLEAR button...")
        page.click("button:has-text('CLEAR')")
        time.sleep(0.5)
        empty_el = page.locator(".attack-log__empty")
        assert empty_el.inner_text() == "No attacks detected yet."
        assert page.locator(".attack-log__pill-badge").inner_text() == "0"

        # Refresh empties log
        print("Testing Refresh empties log...")
        inject_port_scan()
        time.sleep(1.0)
        assert page.locator(".attack-log__pill-badge").inner_text() == "1"
        page.reload()
        page.wait_for_selector("#attack-log-toggle", timeout=10000)
        time.sleep(1.5)
        assert page.locator(".attack-log__pill-badge").inner_text() == "0"

        context.close()
        browser.close()
        print("\nALL VERIFICATIONS PASSED SUCCESSFULLY!")

if __name__ == "__main__":
    run()
