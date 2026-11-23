using UnityEngine;

public class WorkerBox : MonoBehaviour
{
    public Worker loadedWorker;
    public bool IsEmpty() => loadedWorker == null;

    public void LoadWorker(Worker worker)
    {
        if (!IsEmpty()) return;
        loadedWorker = worker;
        // Animate forklift loading the worker into the box
        // Position worker inside box visual
        worker.transform.SetParent(transform);
        // On load complete, optionally auto-launch or wait for tap
    }

    public void LaunchWorker(PixelGrid grid)
    {
        if (loadedWorker == null) return;
        loadedWorker.LaunchToGrid(grid);
        loadedWorker = null;
        // Reset box visual
    }
}
