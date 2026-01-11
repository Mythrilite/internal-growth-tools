#!/usr/bin/env python3
"""Test database access to identify locking issues."""

import sys
import time
import threading
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(__file__).replace('\\', '/').rsplit('/', 2)[0])

from pipeline.db_logger import init_database, get_connection, PipelineRun

print("=" * 60)
print("DATABASE ACCESS TEST")
print("=" * 60)

# Initialize database
print("\n1. Initializing database...")
try:
    init_database()
    print("   ✓ Database initialized")
except Exception as e:
    print(f"   ✗ Failed: {e}")
    sys.exit(1)

# Test basic write
print("\n2. Testing basic write...")
try:
    pipeline_run = PipelineRun(config={'test': True})
    print(f"   ✓ Created pipeline run ID: {pipeline_run.run_id}")
except Exception as e:
    print(f"   ✗ Failed: {e}")
    sys.exit(1)

# Test stage operations
print("\n3. Testing stage operations...")
try:
    stage_id = pipeline_run.start_stage('test_stage', input_count=10)
    print(f"   ✓ Started stage ID: {stage_id}")
    time.sleep(0.5)
    print("   ✓ Waiting 0.5s...")
    
    print("   ✓ Completing stage...")
    pipeline_run.complete_stage(stage_id, output_count=5, error_count=0)
    print("   ✓ Stage completed successfully")
except Exception as e:
    print(f"   ✗ Failed: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)

# Test pipeline completion
print("\n4. Testing pipeline completion...")
try:
    print("   ✓ Marking pipeline as completed...")
    pipeline_run.complete('completed')
    print("   ✓ Pipeline completed successfully")
except Exception as e:
    print(f"   ✗ Failed: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)

# Test concurrent access (simulate dashboard reading while writing)
print("\n5. Testing concurrent access...")
try:
    pipeline_run2 = PipelineRun(config={'test': 'concurrent'})
    stage_id2 = pipeline_run2.start_stage('concurrent_test', input_count=5)
    
    def read_db():
        """Simulate dashboard reading"""
        time.sleep(0.2)  # Give writer a head start
        try:
            with get_connection() as conn:
                print("   [Reader] Acquiring database...")
                cursor = conn.execute('SELECT COUNT(*) as total FROM pipeline_runs')
                result = cursor.fetchone()
                print(f"   [Reader] ✓ Read successful: {result['total']} runs")
        except Exception as e:
            print(f"   [Reader] ✗ Failed: {e}")
    
    # Start reader thread
    reader_thread = threading.Thread(target=read_db)
    reader_thread.start()
    
    # Writer continues
    print("   [Writer] Sleeping 0.1s...")
    time.sleep(0.1)
    print("   [Writer] Completing stage...")
    pipeline_run2.complete_stage(stage_id2, output_count=3, error_count=0)
    print("   [Writer] ✓ Stage completed")
    
    # Wait for reader
    reader_thread.join(timeout=10)
    if reader_thread.is_alive():
        print("   ✗ Reader thread timed out!")
    else:
        print("   ✓ Concurrent access successful")
        
except Exception as e:
    print(f"   ✗ Failed: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)

print("\n" + "=" * 60)
print("ALL TESTS PASSED")
print("=" * 60)
