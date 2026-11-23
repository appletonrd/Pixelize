using UnityEngine;

public class CoinManager : MonoBehaviour
{
    // Integrated with GameManager for simplicity, or expand here for shop

    public void OpenShop()
    {
        // Open IAP popup: green bill button action
        Debug.Log("Open coin shop for real money purchases");
        // Integrate Unity IAP or third-party
    }

    public void BuyCoins(int packageIndex)
    {
        // Handle purchase, then GameManager.Instance.AddCoins(amount)
    }
}
