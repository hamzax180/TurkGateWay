import subprocess
import sys
import os

def run_command(command, cwd=None):
    print(f"\n[{cwd or '.'}] Running: {command}")
    try:
        result = subprocess.run(
            command, 
            shell=True, 
            cwd=cwd, 
            text=True, 
            stdout=subprocess.PIPE, 
            stderr=subprocess.PIPE
        )
        if result.stdout:
            print(result.stdout)
        if result.stderr and result.returncode != 0:
            print(f"Error output:\n{result.stderr}")
    except Exception as e:
        print(f"Failed to run command: {e}")

def main():
    print("=== System Security Update Check ===")
    
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    backend_dir = os.path.join(project_root, "backend")
    
    # 1. Check Python backend dependencies
    print("\n>>> Checking Backend Dependencies (Python)")
    if os.path.exists(backend_dir):
        # We assume pip is available
        run_command("pip list --outdated", cwd=backend_dir)
        # You could also use a tool like safety: run_command("safety check", cwd=backend_dir)
    else:
        print("Backend directory not found.")
        
    # 2. Check Frontend dependencies
    print("\n>>> Checking Frontend Dependencies (Node/npm)")
    if os.path.exists(os.path.join(project_root, "package.json")):
        run_command("npm outdated", cwd=project_root)
        run_command("npm audit", cwd=project_root)
    else:
        print("package.json not found in root.")

if __name__ == "__main__":
    main()
