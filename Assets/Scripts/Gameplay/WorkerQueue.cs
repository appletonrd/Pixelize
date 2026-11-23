using UnityEngine;
using System.Collections.Generic;

public class WorkerQueue : MonoBehaviour
{
    public List<Worker> workersInRow = new List<Worker>();
    public int visibleCount = 4;
    public float spacing = 1.2f;

    public void RemoveAndShift(Worker removed)
    {
        workersInRow.Remove(removed);
        // Animate remaining workers one step forward
        RepositionVisible();
    }

    private void RepositionVisible()
    {
        for (int i = 0; i < Mathf.Min(visibleCount, workersInRow.Count); i++)
        {
            Vector3 pos = transform.position + Vector3.right * i * spacing;
            // Tween workersInRow[i] to pos
            workersInRow[i].transform.position = pos;
        }
        // Hide or disable beyond visible
    }

    public void AddWorkers(List<Worker> newWorkers)
    {
        workersInRow.AddRange(newWorkers);
        RepositionVisible();
    }
}
