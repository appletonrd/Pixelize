using UnityEngine;

public class Worker : MonoBehaviour
{
    public Color workerColor;
    public int rowIndex;

    public void OnTap()
    {
        // Load into first empty WorkerBox
        WorkerBox emptyBox = FindEmptyBox();
        if (emptyBox != null)
        {
            emptyBox.LoadWorker(this);
            // Remove from queue and shift
            GetComponentInParent<WorkerQueue>()?.RemoveAndShift(this);
        }
    }

    private WorkerBox FindEmptyBox()
    {
        // Find among the 5 boxes
        WorkerBox[] boxes = FindObjectsOfType<WorkerBox>();
        foreach (var box in boxes)
        {
            if (box.IsEmpty()) return box;
        }
        return null;
    }

    public void LaunchToGrid(PixelGrid grid)
    {
        // Animate jump to frame, then hammer matching edge pixels
        grid.RemovePixelsOfColor(workerColor);
        // After animation, return or destroy/recycle worker
        Destroy(gameObject);
    }
}
