using UnityEngine;
using UnityEngine.Audio;

public class SettingsManager : MonoBehaviour
{
    public static SettingsManager Instance { get; private set; }

    public bool soundEnabled = true;
    public bool musicEnabled = true;
    public float soundVolume = 1f;
    public float musicVolume = 1f;

    [SerializeField] private AudioMixer mixer; // Optional

    private void Awake()
    {
        if (Instance != null && Instance != this)
        {
            Destroy(gameObject);
            return;
        }
        Instance = this;
        DontDestroyOnLoad(gameObject);
        LoadSettings();
        ApplySettings();
    }

    public void SetSoundEnabled(bool enabled)
    {
        soundEnabled = enabled;
        ApplySettings();
        SaveSettings();
    }

    public void SetMusicEnabled(bool enabled)
    {
        musicEnabled = enabled;
        ApplySettings();
        SaveSettings();
    }

    public void SetSoundVolume(float vol)
    {
        soundVolume = vol;
        ApplySettings();
        SaveSettings();
    }

    public void SetMusicVolume(float vol)
    {
        musicVolume = vol;
        ApplySettings();
        SaveSettings();
    }

    private void ApplySettings()
    {
        // Example: AudioListener.volume or mixer.SetFloat
        AudioListener.volume = soundEnabled ? soundVolume : 0f;
        // Music source volume similarly
    }

    private void LoadSettings()
    {
        soundEnabled = PlayerPrefs.GetInt("SoundEnabled", 1) == 1;
        musicEnabled = PlayerPrefs.GetInt("MusicEnabled", 1) == 1;
        soundVolume = PlayerPrefs.GetFloat("SoundVolume", 1f);
        musicVolume = PlayerPrefs.GetFloat("MusicVolume", 1f);
    }

    private void SaveSettings()
    {
        PlayerPrefs.SetInt("SoundEnabled", soundEnabled ? 1 : 0);
        PlayerPrefs.SetInt("MusicEnabled", musicEnabled ? 1 : 0);
        PlayerPrefs.SetFloat("SoundVolume", soundVolume);
        PlayerPrefs.SetFloat("MusicVolume", musicVolume);
        PlayerPrefs.Save();
    }
}
