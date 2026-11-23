using UnityEngine;

public enum BonusTokenType
{
    SpecialTwoColorWorker,
    ExtraWorkerBox,
    RemoveAllOfColor
}

public class BonusTokenManager : MonoBehaviour
{
    public static BonusTokenManager Instance { get; private set; }

    public int specialWorkerCount = 0;
    public int extraBoxCount = 0;
    public int removeColorCount = 0;

    private void Awake()
    {
        if (Instance != null && Instance != this)
        {
            Destroy(gameObject);
            return;
        }
        Instance = this;
        DontDestroyOnLoad(gameObject);
        LoadTokens();
    }

    public void AwardToken(BonusTokenType type)
    {
        switch (type)
        {
            case BonusTokenType.SpecialTwoColorWorker: specialWorkerCount++; break;
            case BonusTokenType.ExtraWorkerBox: extraBoxCount++; break;
            case BonusTokenType.RemoveAllOfColor: removeColorCount++; break;
        }
        SaveTokens();
        // Update UI counts
    }

    public bool UseToken(BonusTokenType type)
    {
        switch (type)
        {
            case BonusTokenType.SpecialTwoColorWorker:
                if (specialWorkerCount > 0) { specialWorkerCount--; ApplySpecialWorker(); SaveTokens(); return true; }
                break;
            case BonusTokenType.ExtraWorkerBox:
                if (extraBoxCount > 0) { extraBoxCount--; ApplyExtraBox(); SaveTokens(); return true; }
                break;
            case BonusTokenType.RemoveAllOfColor:
                if (removeColorCount > 0) { removeColorCount--; ApplyRemoveColor(); SaveTokens(); return true; }
                break;
        }
        return false;
    }

    private void ApplySpecialWorker()
    {
        // Spawn a special worker with two random colors or dual ability
        Debug.Log("Special two-color worker activated!");
    }

    private void ApplyExtraBox()
    {
        // Temporarily add a 6th box or expand capacity
        Debug.Log("Extra worker box activated!");
    }

    private void ApplyRemoveColor()
    {
        // Open color picker UI for player to select color to clear all of
        Debug.Log("Remove all of selected color activated!");
    }

    private void LoadTokens()
    {
        specialWorkerCount = PlayerPrefs.GetInt("Token_Special", 0);
        extraBoxCount = PlayerPrefs.GetInt("Token_ExtraBox", 0);
        removeColorCount = PlayerPrefs.GetInt("Token_RemoveColor", 0);
    }

    private void SaveTokens()
    {
        PlayerPrefs.SetInt("Token_Special", specialWorkerCount);
        PlayerPrefs.SetInt("Token_ExtraBox", extraBoxCount);
        PlayerPrefs.SetInt("Token_RemoveColor", removeColorCount);
        PlayerPrefs.Save();
    }
}
