using UnityEngine;
using System.Collections.Generic;

public class PixelGrid : MonoBehaviour
{
    public int width = 16;
    public int height = 16;
    public Color[] pixelColors; // Flattened or 2D
    private bool[,] isRemoved;

    public void Initialize(Color[,] colors)
    {
        height = colors.GetLength(0);
        width = colors.GetLength(1);
        isRemoved = new bool[height, width];
        // Setup visual dots/sprites here
    }

    public bool IsEdge(int y, int x)
    {
        if (isRemoved[y, x]) return false;
        // Check neighbors: if any missing or out of bounds, it's edge
        int[] dy = { -1, 1, 0, 0 };
        int[] dx = { 0, 0, -1, 1 };
        for (int i = 0; i < 4; i++)
        {
            int ny = y + dy[i];
            int nx = x + dx[i];
            if (ny < 0 || ny >= height || nx < 0 || nx >= width || isRemoved[ny, nx])
                return true;
        }
        return false;
    }

    public void RemovePixelsOfColor(Color targetColor)
    {
        for (int y = 0; y < height; y++)
        {
            for (int x = 0; x < width; x++)
            {
                if (!isRemoved[y, x] && pixelColors[y * width + x] == targetColor && IsEdge(y, x))
                {
                    isRemoved[y, x] = true;
                    // Hide visual, play hammer effect
                }
            }
        }
        CheckIfComplete();
    }

    public void RemoveAllOfColor(Color targetColor)
    {
        // For bonus token
        for (int y = 0; y < height; y++)
        {
            for (int x = 0; x < width; x++)
            {
                if (!isRemoved[y, x] && pixelColors[y * width + x] == targetColor)
                {
                    isRemoved[y, x] = true;
                }
            }
        }
        CheckIfComplete();
    }

    private void CheckIfComplete()
    {
        // If all removed, complete level
        bool complete = true;
        for (int y = 0; y < height; y++)
            for (int x = 0; x < width; x++)
                if (!isRemoved[y, x]) complete = false;
        if (complete)
            GameManager.Instance.CompleteLevel();
    }
}
