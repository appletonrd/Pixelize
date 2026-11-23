using UnityEngine;
using UnityEngine.SceneManagement;

public class GameManager : MonoBehaviour
{
    public static GameManager Instance { get; private set; }

    public int currentLevel = 1;
    public int coins = 0;

    private void Awake()
    {
        if (Instance != null && Instance != this)
        {
            Destroy(gameObject);
            return;
        }
        Instance = this;
        DontDestroyOnLoad(gameObject);
        LoadProgress();
    }

    public void LoadMainMenu()
    {
        SceneManager.LoadScene("MainMenu");
    }

    public void StartLevel(int level)
    {
        currentLevel = level;
        // Show splash briefly then load game
        SceneManager.LoadScene("Splash");
        // In Splash script, after delay, load Game scene
    }

    public void CompleteLevel()
    {
        currentLevel++;
        // Award points, check progress bar, etc.
        SaveProgress();
        LoadMainMenu();
    }

    private void LoadProgress()
    {
        currentLevel = PlayerPrefs.GetInt("CurrentLevel", 1);
        coins = PlayerPrefs.GetInt("Coins", 0);
    }

    private void SaveProgress()
    {
        PlayerPrefs.SetInt("CurrentLevel", currentLevel);
        PlayerPrefs.SetInt("Coins", coins);
        PlayerPrefs.Save();
    }

    public void AddCoins(int amount)
    {
        coins += amount;
        SaveProgress();
        // Update UI
    }
}
